# Native App Boundaries

TokenTracker ships two desktop wrappers around the bundled Node CLI and built
dashboard.

## macOS

`TokenTrackerBar/` is the Swift/XcodeGen menu-bar application with WidgetKit.
`TokenTrackerBar/TokenTrackerBar/Services/NativeBridge.swift` is the native side of the web
bridge; `dashboard/src/lib/native-bridge.js` is the web side. The generated
`TokenTrackerBar/EmbeddedServer/` directory is build output and is gitignored.

After editing `TokenTrackerBar/project.yml`, follow the XcodeGen and project
patch commands in `CLAUDE.md` before building.

## Windows

`TokenTrackerWin/` is the .NET desktop application using WinForms, WPF, and
WebView2. It bundles the CLI and dashboard with its PowerShell bundling script,
prefers loopback port `17680` and falls back to a dynamic loopback port only
when that port is unavailable. It registers the `tokentracker://` deep link.
Dashboard behavior specific to the Windows host is gated by
`isNativeWindowsApp()` in `dashboard/src/lib/native-bridge.js`.

## Release impact

Any change under `src/` or `dashboard/` affects npm and both native bundles.
Version metadata must remain synchronized across the locations identified in
`CLAUDE.md`, and the combined macOS/Windows release workflow is the authoritative
desktop build path.
