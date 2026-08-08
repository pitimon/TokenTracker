# Archived Native App History

TokenTracker no longer ships or supports native macOS or Windows applications. The active product is the local browser dashboard served by the loopback CLI backend.

## Retained source

- `archive/native-apps/TokenTrackerBar/` contains historical Swift/XcodeGen menu-bar and WidgetKit code.
- `archive/native-apps/TokenTrackerWin/` contains historical .NET/WebView2 tray-app code.
- `archive/native-apps/` also retains their former workflows, tests, and version helpers.

These files are reference material only. They are not active architecture authorities, test targets, version locations, security-support surfaces, or release artifacts. Do not restore native builds or add native features without a new explicit product decision, issue, acceptance criteria, and threat/release review.

## Active boundary

The supported flow is:

```text
AI tool logs -> CLI sync/parsers -> local queues -> loopback HTTP API -> browser dashboard
```

Hosted/cloud service operation, native WebViews, custom URL schemes, DMG artifacts, Windows ZIP/installers, and native auto-update behavior are out of scope.
