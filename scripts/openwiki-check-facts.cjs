const fs = require("node:fs");
const path = require("node:path");

const { extractFacts } = require("./openwiki-extract-facts.cjs");

const ROOT = path.resolve(__dirname, "..");

function readMarkdownFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return readMarkdownFiles(entryPath);
    if (entry.isFile() && entry.name.endsWith(".md")) {
      return [{ path: entryPath, content: fs.readFileSync(entryPath, "utf8") }];
    }
    return [];
  });
}

function findLine(content, index) {
  return content.slice(0, index).split("\n").length;
}

function collectFindings({ facts, files, root = ROOT }) {
  const findings = [];
  const commandNames = new Set(facts.cli.commands.map((command) => command.name));
  const endpointNames = new Set(facts.local_api.endpoints.map((endpoint) => endpoint.path));
  const routeNames = new Set(facts.dashboard.routes.map((route) => route.path));
  const parserNames = new Set(facts.providers.parsers.map((parser) => parser.name));
  const documentedCommands = new Set();
  const documentedEndpoints = new Set();
  const documentedRoutes = new Set();

  for (const file of files) {
    const relative = path.relative(root, file.path);
    for (const match of file.content.matchAll(/(?:npx --yes @ipv9\/tokentracker-cli|(?<![@\w/-])tokentracker(?:-cli)?)[ \t]+([a-z-]+)/g)) {
      const command = match[1];
      if (!commandNames.has(command)) {
        findings.push(`${relative}:${findLine(file.content, match.index)} unknown CLI command '${command}'`);
      } else {
        documentedCommands.add(command);
      }
    }
    for (const match of file.content.matchAll(/\/functions\/tokentracker-[a-z-]+/g)) {
      const endpoint = match[0];
      if (!endpointNames.has(endpoint)) {
        findings.push(`${relative}:${findLine(file.content, match.index)} unknown local endpoint '${endpoint}'`);
      } else {
        documentedEndpoints.add(endpoint);
      }
    }
    for (const match of file.content.matchAll(/`\/(?:dashboard|leaderboard|limits|settings|skills|widgets|ip-check|auth\/(?:callback|native-callback)|login|device|wrapped|landing|share(?:\/:[A-Za-z]+)?|u\/:userId|rankings|menubar)`/g)) {
      const route = match[0].slice(1, -1);
      if (!routeNames.has(route)) {
        findings.push(`${relative}:${findLine(file.content, match.index)} unknown dashboard route '${route}'`);
      } else {
        documentedRoutes.add(route);
      }
    }
    for (const match of file.content.matchAll(/\bparse[A-Za-z0-9]+Incremental\b/g)) {
      if (!parserNames.has(match[0])) {
        findings.push(`${relative}:${findLine(file.content, match.index)} unknown parser '${match[0]}'`);
      }
    }
  }

  const allDocumentation = files.map((file) => file.content).join("\n");
  for (const route of routeNames) {
    if (allDocumentation.includes(`\`${route}\``)) documentedRoutes.add(route);
  }

  for (const command of commandNames) {
    if (command !== "serve" && !documentedCommands.has(command)) {
      findings.push(`openwiki/ missing CLI command '${command}'`);
    }
  }
  for (const endpoint of endpointNames) {
    if (!documentedEndpoints.has(endpoint)) findings.push(`openwiki/ missing local endpoint '${endpoint}'`);
  }
  for (const route of routeNames) {
    if (!documentedRoutes.has(route)) findings.push(`openwiki/ missing dashboard route '${route}'`);
  }
  return findings;
}

function checkFacts({ root = ROOT } = {}) {
  const factsPath = path.join(root, "openwiki-facts", "source-facts.json");
  if (!fs.existsSync(factsPath)) return ["openwiki-facts/source-facts.json is missing; run npm run docs:openwiki:extract"];
  const saved = JSON.parse(fs.readFileSync(factsPath, "utf8"));
  const current = extractFacts({ root });
  const findings = [];
  if (JSON.stringify(saved) !== JSON.stringify(current)) {
    findings.push("openwiki-facts/source-facts.json is stale; run npm run docs:openwiki:extract");
  }
  const files = readMarkdownFiles(path.join(root, "openwiki"));
  if (files.length === 0) {
    findings.push("openwiki/ contains no Markdown documentation");
    return findings;
  }
  return findings.concat(collectFindings({ facts: current, files, root }));
}

function main() {
  const findings = checkFacts();
  console.log(`OpenWiki deterministic fact check: ${findings.length} finding(s)`);
  for (const finding of findings) console.error(`- ${finding}`);
  if (findings.length > 0) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { checkFacts, collectFindings };
