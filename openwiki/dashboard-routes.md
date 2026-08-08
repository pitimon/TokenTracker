# Dashboard Routes

`dashboard/src/App.jsx` selects pages from the current pathname. The dashboard
does not use a generated route table; this mapping is the source-backed route
reference.

| Path | Page |
| --- | --- |
| `/` | `DashboardPage` |
| `/dashboard` | `DashboardPage` |
| `/limits` | `LimitsPage` |
| `/settings` | `SettingsPage` |
| `/skills` | `SkillsPage` |
| `/ip-check` | `IpCheckPage` |
| `/wrapped` | `WrappedPage` |

## Change boundaries

- Add a page module under `dashboard/src/pages/` and map it in `App.jsx`.
- Use `dashboard/src/content/copy.csv` for user-facing copy and run the copy
  validator after edits.
- Follow the existing `AppLayout` conventions for sidebar pages.

For local dashboard data, start at `dashboard/src/lib/api.ts` and the hooks under
`dashboard/src/hooks/`; then trace the matching handler in
[Local API](local-api.md).
