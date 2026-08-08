const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const FACTS_PATH = path.join(ROOT, "openwiki-facts", "source-facts.json");

function read(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function lineFor(source, index) {
  return source.slice(0, index).split("\n").length;
}

function unique(items) {
  return [...new Set(items)];
}

function extractMatches(source, regex, mapMatch) {
  const results = [];
  let match;
  while ((match = regex.exec(source))) {
    results.push(mapMatch(match));
  }
  return results;
}

function extractLocalApiMethodAllowlist(source) {
  const declaration = source.match(/const LOCAL_API_METHODS = new Map\(\[([\s\S]*?)\]\);/);
  if (!declaration) throw new Error("LOCAL_API_METHODS declaration not found");

  return new Map(extractMatches(
    declaration[1],
    /\["([^"]+)", \[([^\]]+)\]\]/g,
    (match) => [
      match[1],
      extractMatches(match[2], /"([A-Z]+)"/g, (methodMatch) => methodMatch[1]),
    ],
  ));
}

function extractFacts({ root = ROOT } = {}) {
  const cliPath = "src/cli.js";
  const apiPath = "src/lib/local-api.js";
  const appPath = "dashboard/src/App.jsx";
  const rolloutPath = "src/lib/rollout.js";

  const cli = read(root, cliPath);
  const api = read(root, apiPath);
  const app = read(root, appPath);
  const rollout = read(root, rolloutPath);
  const methodAllowlist = extractLocalApiMethodAllowlist(api);

  const commands = extractMatches(cli, /case "([a-z-]+)":/g, (match) => ({
    name: match[1],
    evidence: `${cliPath}:${lineFor(cli, match.index)}`,
  }));
  commands.unshift({
    name: "serve",
    default: true,
    evidence: `${cliPath}:${lineFor(cli, cli.indexOf("await cmdServe([\"--sync\"])"))}`,
  });

  const endpointMatches = extractMatches(
    api,
    /if \(p === "(\/(?:functions\/tokentracker-[a-z-]+|api\/[a-z-]+))"\)/g,
    (match) => ({
      path: match[1],
      index: match.index,
    }),
  );
  const proxyPrefix = api.match(/const IP_CHECK_PROXY_PREFIX = "([^"]+)"/)?.[1];
  const proxyIndex = api.indexOf("if (p.startsWith(`${IP_CHECK_PROXY_PREFIX}/`) || p === IP_CHECK_PROXY_PREFIX)");
  if (!proxyPrefix || proxyIndex < 0) throw new Error("IP-check proxy handler not found");
  endpointMatches.push({ path: proxyPrefix, index: proxyIndex });
  endpointMatches.sort((a, b) => a.index - b.index);

  for (const endpointPath of methodAllowlist.keys()) {
    if (!endpointMatches.some((endpoint) => endpoint.path === endpointPath)) {
      throw new Error(`No local API handler for LOCAL_API_METHODS entry ${endpointPath}`);
    }
  }

  const endpoints = endpointMatches.map((endpoint, index) => {
    const next = endpointMatches[index + 1]?.index ?? api.length;
    const block = api.slice(endpoint.index, next);
    const methods = methodAllowlist.get(endpoint.path);
    if (!methods) throw new Error(`No LOCAL_API_METHODS entry for ${endpoint.path}`);
    return {
      path: endpoint.path,
      methods,
      evidence: `${apiPath}:${lineFor(api, endpoint.index)}`,
      mutation: /isAuthorizedLocalMutation/.test(block),
    };
  });

  const routes = [
    { path: "/", component: "DashboardPage", evidence: `${appPath}:${lineFor(app, app.indexOf("isDashboardDefaultPath"))}` },
    { path: "/dashboard", component: "DashboardPage", evidence: `${appPath}:${lineFor(app, app.indexOf("isDashboardDefaultPath"))}` },
  ];
  const routeComponents = [
    ["/limits", "LimitsPage"],
    ["/settings", "SettingsPage"],
    ["/skills", "SkillsPage"],

    ["/ip-check", "IpCheckPage"],
    ["/wrapped", "WrappedPage"],
  ];
  for (const [routePath, component] of routeComponents) {
    const literal = routePath.replace(/\/:.+$/, "");
    const index = app.indexOf(literal);
    if (index >= 0) {
      routes.push({ path: routePath, component, evidence: `${appPath}:${lineFor(app, index)}` });
    }
  }

  const parsers = extractMatches(
    rollout,
    /async function (parse[A-Za-z0-9]+Incremental)\(/g,
    (match) => ({
      name: match[1],
      evidence: `${rolloutPath}:${lineFor(rollout, match.index)}`,
    }),
  );

  return {
    schema_version: 1,
    cli: { commands: unique(commands.map((command) => command.name)).map((name) => commands.find((command) => command.name === name)) },
    local_api: { endpoints },
    dashboard: { routes },
    providers: { parsers },
  };
}

function writeFacts({ root = ROOT, outputPath = null } = {}) {
  const destination = outputPath || path.join(root, "openwiki-facts", "source-facts.json");
  const facts = extractFacts({ root });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(facts, null, 2)}\n`, "utf8");
  return facts;
}

function main() {
  const facts = writeFacts();
  console.log(
    `OpenWiki source facts: ${facts.cli.commands.length} commands, ${facts.local_api.endpoints.length} endpoints, ${facts.dashboard.routes.length} routes, ${facts.providers.parsers.length} parsers -> ${path.relative(ROOT, FACTS_PATH)}`,
  );
}

if (require.main === module) main();

module.exports = { extractFacts, extractLocalApiMethodAllowlist, writeFacts };
