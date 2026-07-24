const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const fssync = require("node:fs");

const { resolveTrackerPaths } = require("../lib/tracker-paths");
const { createLocalApiHandler, resolveQueuePath, isLoopbackHostname } = require("../lib/local-api");
const {
  buildServeDataPreflightMessage,
  summarizeQueueData,
} = require("../lib/local-data-preflight");
const { ensurePricingLoaded } = require("../lib/pricing");
const { serveStaticFile } = require("../lib/static-server");
const { openInBrowser } = require("../lib/browser-open");

const DEFAULT_PORT = 7680;
const DEFAULT_MAX_PORT_ATTEMPTS = 20;
const NPM_PACKAGE_NAME = "@ipv9/tokentracker-cli";
const LOCAL_BIND_HOST = "127.0.0.1";

// Anti-DNS-rebinding guard. Binding the socket to loopback does not make the
// Host header trustworthy: under DNS rebinding a browser sends
// `Host: attacker.example:<port>` to 127.0.0.1 and treats the response as
// same-origin, so CORS never applies. Mutations are already gated on a loopback
// Origin; without this check every GET /functions/* endpoint — full spend
// history, model mix, project names — is readable by any page the victim
// happens to have open. Issue #88.
//
// Only the hostname matters: the port is chosen at runtime by
// listenOnAvailablePort, so pinning it here would be fragile without adding any
// protection. An absent Host (HTTP/1.0, some local probes) is allowed — the
// socket is already loopback-bound, and there is no rebinding vector without a
// browser sending a name.
function isAllowedHostHeader(hostHeader) {
  if (hostHeader == null || hostHeader === "") return true;
  // Userinfo has no meaning in a Host header, so anything carrying it is
  // malformed. Tested on the RAW value: an EMPTY userinfo ("@localhost",
  // ":@localhost") parses to a falsy url.username, so checking the parsed
  // fields alone lets exactly the malformed forms through.
  if (hostHeader.includes("@")) return false;
  try {
    const url = new URL(`http://${hostHeader}`);
    // `localhost.` is the valid fully-qualified spelling of localhost. WHATWG
    // URL canonicalises the trailing dot away for IPv4 literals but not for
    // names, so strip it here or the FQDN form gets a spurious 403.
    return isLoopbackHostname(url.hostname.replace(/\.$/, ""));
  } catch (_e) {
    return false;
  }
}

// An origin server is not a proxy: a request-target must be origin-form
// ("/path") or asterisk-form ("*"). Absolute-form ("GET http://evil/x") carries
// its own authority, which WOULD win over the Host header when the URL is
// parsed for routing — so the Host allowlist and the routing would disagree
// about which site this request is for. Refuse instead of picking a winner.
function isAllowedRequestTarget(target) {
  if (typeof target !== "string" || target === "") return false;
  if (target === "*") return true;
  if (!target.startsWith("/")) return false;
  // "//evil/x" is a network-path reference, and WHATWG URL treats a backslash
  // like a slash, so "/\evil/x" behaves the same way: both make the parsed URL
  // adopt a foreign authority even though the Host header said loopback.
  // Routing only reads url.pathname today, but leaving the parsed URL pointing
  // at someone else's origin is the same guard-vs-parser disagreement that
  // absolute-form creates.
  if (target.startsWith("//") || target.startsWith("/\\")) return false;
  return true;
}

// Extracted from cmdServe so the wiring — not just the predicate — is testable:
// a guard that exists but is never reached is the failure mode this is guarding
// against in the first place.
function createRequestHandler({ handleApi, dashboardDir }) {
  return async function handleRequest(req, res) {
    try {
      // Reject rebound hostnames before anything reads the request. Issue #88.
      if (!isAllowedHostHeader(req.headers.host)) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("Forbidden: TokenTracker only serves loopback hosts.\n");
        return;
      }

      if (!isAllowedRequestTarget(req.url)) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Bad Request: absolute-form request targets are not served.\n");
        return;
      }

      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

      // CORS preflight
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        });
        res.end();
        return;
      }

      // API routes
      if (
        url.pathname.startsWith("/functions/")
        || url.pathname.startsWith("/api/")
        || url.pathname.startsWith("/proxy/")
      ) {
        const handled = await handleApi(req, res, url);
        if (handled) return;
      }

      // Static files
      const served = await serveStaticFile(dashboardDir, url.pathname, res);
      if (served) return;

      // SPA fallback
      await serveStaticFile(dashboardDir, "/index.html", res);
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal Server Error");
      }
    }
  };
}

function buildPortInUseHint(port) {
  return `Port ${port} is unavailable. Try: npx ${NPM_PACKAGE_NAME} serve --port ${port + 1}\n`;
}

function isPortUnavailableError(error) {
  return error?.code === "EADDRINUSE" || error?.code === "EACCES" || error?.code === "EPERM";
}

function getLocalServerUrl(port) {
  return `http://${LOCAL_BIND_HOST}:${port}`;
}

async function cmdServe(argv) {
  const opts = parseArgs(argv);

  // 0. First-time setup: if tracker dir doesn't exist, run init first
  const { trackerDir } = await resolveTrackerPaths();
  if (!fssync.existsSync(path.join(trackerDir, "cursors.json"))) {
    process.stdout.write("First time? Setting up Token Tracker...\n\n");
    try {
      const { cmdInit } = require("./init");
      await cmdInit(["--yes"]);
    } catch (e) {
      process.stdout.write(`Init warning: ${e?.message || e}\n`);
    }
  }

  try {
    const { installLocalTrackerApp } = require("./init");
    await installLocalTrackerApp({ appDir: path.join(trackerDir, "app") });
  } catch (e) {
    process.stdout.write(`Runtime refresh warning: ${e?.message || e}\n`);
  }

  // 1. Optional sync
  let syncSummary = null;
  if (opts.sync) {
    process.stdout.write("Syncing local data...\n");
    try {
      const { cmdSync } = require("./sync");
      syncSummary = await cmdSync(["--auto"]);
      process.stdout.write("Sync done.\n");
    } catch (e) {
      process.stdout.write(`Sync warning: ${e?.message || e}\n`);
    }
  }

  // 2. Resolve paths
  const queuePath = resolveQueuePath();
  const dashboardDir = resolveDashboardDir();

  if (opts.sync) {
    try {
      const queueSummary = await summarizeQueueData(queuePath);
      const preflight = buildServeDataPreflightMessage({ queueSummary, syncSummary });
      if (preflight?.message) {
        process.stdout.write(`${preflight.message}\n`);
      }
    } catch (e) {
      process.stdout.write(`Token data preflight warning: ${e?.message || e}\n`);
    }
  }

  // 2.1 Refresh LiteLLM pricing data in the background. The seed snapshot is
  //     already loaded synchronously at require-time, so cost calculation is
  //     functional right now; ensurePricingLoaded() only upgrades to fresh
  //     disk cache or upstream data. Awaiting it here would block startup
  //     for the full 10s fetch timeout when offline / behind a firewall.
  const { cacheDir } = await resolveTrackerPaths();
  ensurePricingLoaded({ cachePath: path.join(cacheDir, "pricing.json") }).catch(
    (e) => process.stdout.write(`Pricing refresh warning: ${e?.message || e}\n`),
  );

  if (!dashboardDir) {
    process.stderr.write(
      [
        "Dashboard not found.",
        "",
        "If you cloned the repo, run:",
        "  cd dashboard && npm run build",
        "",
        "If you installed via npm, the package may be missing dashboard/dist/.",
        "",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  // 3. Create handler
  const handleApi = createLocalApiHandler({ queuePath });

  const server = http.createServer(createRequestHandler({ handleApi, dashboardDir }));

  // 4. Listen. Default startup follows README behavior and picks the next
  // available port; an explicit --port/PORT remains strict.
  let port;
  try {
    port = await listenOnAvailablePort(server, opts.port, {
      allowFallback: !opts.portExplicit,
      onRetry: (failedPort) => {
        process.stdout.write(`Port ${failedPort} unavailable, trying ${failedPort + 1}...\n`);
      },
    });
  } catch (e) {
    if (isPortUnavailableError(e)) {
      process.stderr.write(buildPortInUseHint(opts.port));
    } else {
      process.stderr.write(`Server error: ${e.message}\n`);
    }
    process.exitCode = 1;
    return;
  }

  {
    const url = getLocalServerUrl(port);
    process.stdout.write(
      [
        "",
        `  tokentracker dashboard running at:`,
        "",
        `    ${url}`,
        "",
        `  Data: ${queuePath}`,
        `  Press Ctrl+C to stop.`,
        "",
      ].join("\n"),
    );

    if (opts.open) {
      openInBrowser(url);
    }
  }

  server.on("error", (e) => {
    process.stderr.write(`Server error: ${e.message}\n`);
    process.exitCode = 1;
  });

  // 5. Graceful shutdown
  const shutdown = () => {
    process.stdout.write("\nShutting down...\n");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep process alive
  await new Promise(() => {});
}

function listenOnce(server, port, host) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      server.off("listening", onListening);
      server.off("error", onError);
    };
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const onListening = () => finish(resolve);
    const onError = (error) => finish(reject, error);

    server.once("listening", onListening);
    server.once("error", onError);
    try {
      server.listen(port, host);
    } catch (error) {
      finish(reject, error);
    }
  });
}

async function listenOnAvailablePort(
  server,
  startPort,
  {
    host = LOCAL_BIND_HOST,
    allowFallback = false,
    maxAttempts = DEFAULT_MAX_PORT_ATTEMPTS,
    onRetry = null,
  } = {},
) {
  const attempts = allowFallback ? Math.max(1, maxAttempts) : 1;
  let port = startPort;
  let lastError = null;

  for (let i = 0; i < attempts && port < 65536; i++, port++) {
    try {
      await listenOnce(server, port, host);
      return port;
    } catch (error) {
      lastError = error;
      if (!allowFallback || !isPortUnavailableError(error) || port >= 65535) {
        throw error;
      }
      if (typeof onRetry === "function") {
        onRetry(port, error);
      }
    }
  }

  throw lastError || new Error(`No available port found from ${startPort}`);
}

function resolveDashboardDir() {
  const candidates = [
    path.resolve(__dirname, "../../dashboard/dist"),
    path.resolve(__dirname, "../dashboard/dist"),
  ];
  for (const dir of candidates) {
    if (fssync.existsSync(path.join(dir, "index.html"))) return dir;
  }
  return null;
}

function parsePort(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 && n < 65536 ? n : null;
}

function parseArgs(argv, env = process.env) {
  const envPort = parsePort(env.PORT);
  const opts = {
    port: envPort || DEFAULT_PORT,
    portExplicit: Boolean(envPort),
    open: false,
    sync: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port" && i + 1 < argv.length) {
      const n = parsePort(argv[++i]);
      if (n) {
        opts.port = n;
        opts.portExplicit = true;
      }
    } else if (arg === "--no-open") {
      opts.open = false;
    } else if (arg === "--open") {
      opts.open = true;
    } else if (arg === "--sync") {
      opts.sync = true;
    } else if (arg === "--no-sync") {
      opts.sync = false;
    }
  }
  return opts;
}

module.exports = {
  cmdServe,
  buildPortInUseHint,
  NPM_PACKAGE_NAME,
  LOCAL_BIND_HOST,
  isPortUnavailableError,
  isAllowedHostHeader,
  isAllowedRequestTarget,
  createRequestHandler,
  listenOnAvailablePort,
  getLocalServerUrl,
  parseArgs,
};
