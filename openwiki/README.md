# TokenTracker OpenWiki

This directory is the source-backed engineering map for TokenTracker. It covers
the local CLI backend, browser dashboard, and checks used to keep documentation
aligned with the repository. Native wrappers are archived and unsupported.

## System diagram

```mermaid
flowchart TD
    tools["AI coding tools<br/>session logs (read-only *.jsonl)"]

    subgraph runtime["Node CLI — bin/tracker.js → src/cli.js"]
        direction TB
        parsers["src/lib/rollout.js<br/>incremental parsers"]
        queue[("local queue files<br/>token counts + timestamps")]
        serve["src/commands/serve.js<br/>loopback HTTP server"]
        api["src/lib/local-api.js<br/>dynamic endpoints"]
    end

    subgraph front["Dashboard build"]
        direction TB
        dsrc["dashboard/ — React source"]
        dist["dashboard/dist/ — static SPA"]
    end

    consumers["Browser at a local URL"]

    tools -->|read| parsers
    parsers --> queue
    queue --> api
    serve --> api
    serve -->|serves static| dist
    dsrc -->|build| dist
    api -->|usage + cost JSON| consumers
    dist -->|SPA| consumers

    classDef store stroke:#0d9488,stroke-width:2px;
    classDef edge stroke:#6b7280;
    class queue store;
    class tools,consumers edge;
```

The runtime processes usage metadata — source, model, token and conversation counts, timestamps, and derived cost.
The queue stores the usage fields and timestamps; derived cost is computed downstream, not stored in the queue.
Never persist prompts, responses, message bodies, or private user-code paths.
Credentials are used only for declared provider authentication or quota flows and their credential files; never place them in TokenTracker queues, logs, fixtures, diagnostics, API responses, or unrelated outbound payloads.

<details>
<summary>Text version of the diagram</summary>

```text
  AI coding tools
  (logs and hooks)
          |
          v
  +-------------------------+
  | src/lib/rollout.js      |
  | incremental parsers     |
  +-------------------------+
          |
          v
  +-------------------------+
  | local queue files       |
  | token counts + times    |
  +-------------------------+
          |
          v
  +-------------------------+          +--------------------------+
  | Node CLI                |          | dashboard/                |
  | bin/tracker.js          |--------->| React source              |
  | src/cli.js              |  build   | dashboard/dist/           |
  +-------------------------+          +--------------------------+
          |
          | serve
          v
  +-----------------------------------------------+
  | loopback HTTP server                           |
  | src/commands/serve.js                          |
  |   +-- src/lib/local-api.js (dynamic endpoints) |
  |   +-- dashboard/dist (static SPA)              |
  +-----------------------------------------------+
          |
          v
  browser at a local URL
```

</details>

The diagram above shows the components. For how usage data moves and is
transformed between them, see the [Data flow](architecture/dataflow.md) view.

## Start here

- [Working on this documentation](quickstart.md): the source ledger, the
  regeneration commands, and what the fact checker enforces.
- [Architecture](architecture/overview.md): runtime components and boundaries.
- [Data flow](architecture/dataflow.md): how usage data moves from tool logs to
  the dashboard, with a leveled data-flow diagram.
- [CLI and operations](cli-and-operations.md): CLI command ownership and
  loopback-server behavior.
- [Parsers and sync](parsers-and-sync.md): parser entry points and aggregation.
- [Local API](local-api.md): documented local endpoints.
- [Dashboard routes](dashboard-routes.md): route ownership and route list.
- [Archived native history](native-app-boundaries.md): unsupported macOS/Windows source retained for reference.
- [Testing and release](testing-and-release.md): validation and release scope.

## Keep the documentation factual

`CLAUDE.md` is the workflow and release authority. The machine-derived ledger
at `openwiki-facts/source-facts.json` is the authority for documented CLI
commands, local endpoints, dashboard paths, and parser symbols.

```bash
npm run docs:openwiki:extract
npm run docs:openwiki:check
```

For a model-backed local refresh, use `npm run docs:openwiki:update`. For the
independent read-only review, use `npm run docs:openwiki:verify`. Both commands
use credentials from the caller environment; they do not read credentials from
this repository.
