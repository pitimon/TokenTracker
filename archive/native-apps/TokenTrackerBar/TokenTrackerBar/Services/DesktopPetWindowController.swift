import AppKit
import SwiftUI

/// A transparent, always-on-top, non-activating floating window that hosts the Clawd
/// companion as a desktop pet — the macOS counterpart of the Windows pet window
/// (PR #128). Where Windows had to host a WebView (no native Clawd renderer in .NET),
/// macOS hosts the native SwiftUI `ClawdCompanionView` directly and shares the app's
/// single `DashboardViewModel`, so the pet never polls independently and never drifts
/// from the menu bar.
@MainActor
final class DesktopPetWindowController: NSObject, NSWindowDelegate {
    /// Persists whether the user had the pet showing, so it returns on next launch.
    static let showDefaultsKey = "DesktopPetShow"
    private static let frameAutosaveName = "DesktopPetWindow"
    // Wide enough to fully contain the longest data bubble (e.g. "309.8M tokens —
    // $197.41 spent today"); the window is transparent so the extra width is invisible —
    // it just lets the centered bubble render without hitting the window edge (which
    // caused clipping → drift/flicker). The sprite stays centered in this width.
    private static let petSize = NSSize(width: 540, height: 150)
    /// Minimum on-screen width before the bubble is allowed. Below this — dragging the
    /// pet off the side, or tucked at an edge — the bubble is hidden so it never tries
    /// to render in a clipped width and flicker.
    private static let bubbleMinWidth: CGFloat = 460
    /// How much of the *sprite* peeks out when tucked against an edge.
    private static let edgePeek: CGFloat = 30
    /// A drag that ends within this distance of the left/right edge tucks the pet away.
    private static let snapMargin: CGFloat = 24
    /// The sprite is horizontally centered in the (wider) panel; these mirror
    /// ClawdCompanionView's floating layout — sprite = 15 * px(4) * floatingScale(1.4)
    /// = 84pt — so tucking exposes the *sprite*, not the panel's transparent margin.
    private static let spriteWidth: CGFloat = 84
    private static var spriteLeftInset: CGFloat { (petSize.width - spriteWidth) / 2 }

    private enum Edge { case left, right }

    private let viewModel: DashboardViewModel
    private var panel: NSPanel?
    private var dragMonitor: Any?
    private var upMonitor: Any?
    /// nil → freely placed; otherwise the edge the pet is tucked against.
    private var hiddenEdge: Edge?
    private var isRevealed = false
    private var didDrag = false
    /// Drives whether the floating bubble may show (enough of the pet is on-screen).
    let uiState = PetWindowState()

    init(viewModel: DashboardViewModel) {
        self.viewModel = viewModel
        super.init()
    }

    var isVisible: Bool { panel?.isVisible ?? false }

    func toggle() {
        if isVisible { hide() } else { show() }
    }

    func show() {
        let panel = panel ?? makePanel()
        self.panel = panel
        panel.orderFrontRegardless()
        UserDefaults.standard.set(true, forKey: Self.showDefaultsKey)
    }

    func hide() {
        panel?.orderOut(nil)
        UserDefaults.standard.set(false, forKey: Self.showDefaultsKey)
    }

    /// Re-show the pet on launch if it was visible when the app last quit.
    func restoreIfNeeded() {
        if UserDefaults.standard.bool(forKey: Self.showDefaultsKey) { show() }
    }

    private func makePanel() -> NSPanel {
        let size = Self.petSize
        // Use a hosting *controller* (not a bare NSHostingView as contentView): on a
        // borderless panel the latter routes SwiftUI's per-frame invalidations into
        // -[NSWindow _postWindowNeedsUpdateConstraints], which throws and crashes. A
        // fixed-frame root keeps sizing deterministic so no constraint cycle runs.
        let hostingController = NSHostingController(
            rootView: ClawdCompanionView(
                viewModel: viewModel,
                layout: .floating,
                onRequestDashboard: { DashboardWindowController.shared.showWindow() },
                onClosePet: { [weak self] in self?.hide() },
                onHoverChanged: { [weak self] hovering in self?.handleHover(hovering) },
                petState: uiState
            )
            .frame(width: size.width, height: size.height)
        )

        let panel = PetPanel(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.contentViewController = hostingController
        // Transparent: only Clawd's opaque pixels (and the bubble material) show.
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        // Float above normal windows, ride along to every Space / full-screen app,
        // and stay out of Cmd-Tab cycling. Never activate the app on click.
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        panel.isMovableByWindowBackground = true
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.acceptsMouseMovedEvents = true

        // Restore the last drag position, or park near the bottom-right on first run.
        panel.setFrameAutosaveName(Self.frameAutosaveName)
        if !panel.setFrameUsingName(Self.frameAutosaveName), let screen = NSScreen.main {
            let area = screen.visibleFrame
            panel.setFrameOrigin(NSPoint(x: area.maxX - size.width - 40, y: area.minY + 60))
        }
        self.panel = panel
        panel.delegate = self
        // If the saved frame had it tucked against an edge, restore that tucked state
        // (so a hover still slides it out).
        detectTuckedState(panel)
        installDragMonitors(panel)
        updateBubbleAllowed()
        return panel
    }

    // MARK: - Bubble width gating

    func windowDidMove(_ notification: Notification) {
        updateBubbleAllowed()
    }

    /// Hide the bubble whenever too little of the pet is on-screen (edge-tucked, or being
    /// dragged off the side), so it never flickers trying to render in a clipped width.
    private func updateBubbleAllowed() {
        guard let panel, let screen = panel.screen ?? NSScreen.main else { return }
        let visibleW = panel.frame.intersection(screen.visibleFrame).width
        let allowed = visibleW >= Self.bubbleMinWidth
        if uiState.bubbleAllowed != allowed { uiState.bubbleAllowed = allowed }
    }

    // MARK: - Drag cursor + edge tucking

    private func installDragMonitors(_ panel: NSPanel) {
        // Closed-hand "grab" cursor while dragging the pet; restore the open hand on drop.
        dragMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDragged]) { [weak self, weak panel] event in
            if event.window === panel {
                Task { @MainActor [weak self] in
                    self?.didDrag = true
                    NSCursor.closedHand.set()
                }
            }
            return event
        }
        upMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseUp]) { [weak self, weak panel] event in
            if event.window === panel {
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    if self.didDrag {            // only after a real drag, not a tap
                        NSCursor.openHand.set()
                        self.snapToEdgeIfNeeded()
                    }
                    self.didDrag = false
                }
            }
            return event
        }
    }

    /// On drop, tuck the pet away if it landed against the left/right edge.
    private func snapToEdgeIfNeeded() {
        guard let panel, let screen = panel.screen else { return }
        let vf = screen.visibleFrame
        let f = panel.frame
        // Decide by the sprite's edges (not the panel's), so it snaps when the *crab*
        // reaches the screen edge.
        let spriteLeft = f.origin.x + Self.spriteLeftInset
        let spriteRight = spriteLeft + Self.spriteWidth
        if spriteRight >= vf.maxX - Self.snapMargin {
            hiddenEdge = .right
            isRevealed = false
            applyEdgeFrame(animated: true)
        } else if spriteLeft <= vf.minX + Self.snapMargin {
            hiddenEdge = .left
            isRevealed = false
            applyEdgeFrame(animated: true)
        } else {
            hiddenEdge = nil
        }
    }

    /// Hovering an edge-tucked pet slides it fully into view; leaving tucks it back.
    private func handleHover(_ hovering: Bool) {
        guard hiddenEdge != nil else { return }
        if hovering, !isRevealed {
            isRevealed = true
            applyEdgeFrame(animated: true)
        } else if !hovering, isRevealed {
            isRevealed = false
            applyEdgeFrame(animated: true)
        }
    }

    /// Detect whether the (restored) frame is sitting mostly off-screen against an edge.
    private func detectTuckedState(_ panel: NSPanel) {
        guard let screen = panel.screen ?? NSScreen.main else { return }
        let vf = screen.visibleFrame
        let f = panel.frame
        // Use the SPRITE center (matching snapToEdgeIfNeeded), not the panel center —
        // the panel is far wider than the sprite, so a panel-center test would never see
        // a tucked sprite as tucked and the pet would restore stuck-but-unhoverable.
        let spriteCenter = f.origin.x + Self.spriteLeftInset + Self.spriteWidth / 2
        if spriteCenter > vf.maxX {
            hiddenEdge = .right; isRevealed = false
        } else if spriteCenter < vf.minX {
            hiddenEdge = .left; isRevealed = false
        }
    }

    /// Position the pet for its current `hiddenEdge` + `isRevealed` state.
    private func applyEdgeFrame(animated: Bool) {
        guard let panel, let screen = panel.screen, let edge = hiddenEdge else { return }
        let vf = screen.visibleFrame
        var f = panel.frame
        switch (edge, isRevealed) {
        // Revealed: the SPRITE sits flush against the screen edge (not the wide window
        // centered), so it slides out right under the cursor hovering the peek — the
        // cursor stays on the sprite, hover holds, and the reveal/tuck loop can't start.
        case (.right, true):  f.origin.x = vf.maxX - (Self.spriteLeftInset + Self.spriteWidth)
        case (.right, false): f.origin.x = vf.maxX - Self.spriteLeftInset - Self.edgePeek
        case (.left, true):   f.origin.x = vf.minX - Self.spriteLeftInset
        case (.left, false):  f.origin.x = vf.minX + Self.edgePeek - (Self.spriteLeftInset + Self.spriteWidth)
        }
        if animated {
            NSAnimationContext.runAnimationGroup { ctx in
                ctx.duration = 0.22
                panel.animator().setFrame(f, display: true)
            }
        } else {
            panel.setFrame(f, display: true)
        }
    }

    deinit {
        if let dragMonitor { NSEvent.removeMonitor(dragMonitor) }
        if let upMonitor { NSEvent.removeMonitor(upMonitor) }
    }
}

/// Borderless panels can't become key by default, which would swallow SwiftUI taps and
/// hover tracking. Allow key (so gestures work) while `.nonactivatingPanel` keeps a
/// click from ever stealing focus from the user's frontmost app.
private final class PetPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

/// Observable flag shared with the floating ClawdCompanionView: the bubble is only
/// shown when enough of the pet is on-screen (set by DesktopPetWindowController).
@MainActor
final class PetWindowState: ObservableObject {
    static let alwaysAllowed = PetWindowState()
    @Published var bubbleAllowed = true
}
