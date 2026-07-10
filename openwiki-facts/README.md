# OpenWiki Facts

`source-facts.json` is a deterministic ledger derived from TokenTracker source.
It protects generated documentation from inventing CLI commands, local API
endpoints, dashboard routes, or parser names.

Regenerate it before an OpenWiki update:

```bash
npm run docs:openwiki:extract
```

After generation, run the deterministic gate and then the independent verifier:

```bash
npm run docs:openwiki:check
npm run docs:openwiki:verify
```

The ledger never contains credentials or user usage data. It is a navigation aid,
not a replacement for the source cited in each fact.
