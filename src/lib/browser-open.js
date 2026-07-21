// Opens a URL in the user's browser. This module used to also run the cloud
// sign-in flow (a local callback server plus a redirect dance); that went away
// with the cloud, and the file was renamed so its name stops implying auth.
const cp = require("node:child_process");

function detectDefaultBrowser() {
  try {
    const raw = cp.execFileSync("defaults", [
      "read", "com.apple.LaunchServices/com.apple.launchservices.secure", "LSHandlers",
    ], { encoding: "utf8", timeout: 3000 });
    const match = raw.match(/https[\s\S]*?LSHandlerRoleAll\s*=\s*"([^"]+)"/);
    if (!match) return null;
    const bundleId = match[1].toLowerCase();
    if (bundleId.includes("chrome")) return "Google Chrome";
    if (bundleId.includes("safari")) return "Safari";
    if (bundleId.includes("edgemac")) return "Microsoft Edge";
    if (bundleId.includes("thebrowser") || bundleId.includes("arc")) return "Arc";
    return null;
  } catch (_e) {
    return null;
  }
}

function buildBrowserList() {
  const all = ["Google Chrome", "Safari", "Microsoft Edge", "Arc"];
  const def = detectDefaultBrowser();
  if (!def) return all;
  return [def, ...all.filter((b) => b !== def)];
}

function buildBrowserOpenErrorMessage({ url, command, error, platform = process.platform } = {}) {
  const commandName =
    command || (platform === "win32" ? "cmd" : platform === "darwin" ? "open" : "xdg-open");
  const reason =
    error?.code === "ENOENT" ? `${commandName} not found` : error?.message || String(error || "unknown error");
  const lines = [
    `Could not open browser automatically: ${reason}.`,
    `Open manually: ${url}`,
  ];
  if (platform === "linux" && commandName === "xdg-open") {
    lines.push("Linux fix: sudo apt install -y xdg-utils");
  }
  return `${lines.join("\n")}\n`;
}

function spawnBrowserCommand(
  command,
  args,
  { url, platform = process.platform, stderr = process.stderr, spawn = cp.spawn } = {},
) {
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", (error) => {
      stderr.write(buildBrowserOpenErrorMessage({ url, command, error, platform }));
    });
    child.unref();
    return child;
  } catch (error) {
    stderr.write(buildBrowserOpenErrorMessage({ url, command, error, platform }));
    return null;
  }
}

function openInBrowser(url, { stderr = process.stderr } = {}) {
  const platform = process.platform;

  if (platform === "darwin") {
    // On macOS, prefer reusing a matching tab in a supported running browser.
    // Supported browsers are checked with the user's default browser first.
    const browsers = buildBrowserList();
    const listLiteral = browsers.map((b) => `"${b}"`).join(", ");
    const script = `
tell application "System Events"
  set browserList to {${listLiteral}}
  set runningBrowser to ""
  repeat with b in browserList
    if (exists process (b as text)) then
      set runningBrowser to (b as text)
      exit repeat
    end if
  end repeat
end tell

if runningBrowser is "" then
  open location "${url}"
else if runningBrowser is "Google Chrome" then
  tell application "Google Chrome"
    set found to false
    repeat with w in windows
      set tabIndex to 0
      repeat with t in tabs of w
        set tabIndex to tabIndex + 1
        if URL of t starts with "${url}" then
          set active tab index of w to tabIndex
          set index of w to 1
          reload t
          activate
          set found to true
          exit repeat
        end if
      end repeat
      if found then exit repeat
    end repeat
    if not found then
      open location "${url}"
      activate
    end if
  end tell
else if runningBrowser is "Safari" then
  tell application "Safari"
    set found to false
    repeat with w in windows
      set tabIndex to 0
      repeat with t in tabs of w
        set tabIndex to tabIndex + 1
        if URL of t starts with "${url}" then
          set current tab of w to t
          set index of w to 1
          do JavaScript "location.reload()" in t
          activate
          set found to true
          exit repeat
        end if
      end repeat
      if found then exit repeat
    end repeat
    if not found then
      open location "${url}"
      activate
    end if
  end tell
else
  open location "${url}"
end if
`;
    const child = spawnBrowserCommand("osascript", ["-e", script], { url, platform, stderr });
    if (!child) {
      // Fallback to plain open
      spawnBrowserCommand("open", [url], { url, platform, stderr });
    }
    return;
  }

  let cmd = null;
  let args = [];

  if (platform === "win32") {
    cmd = "cmd";
    args = ["/c", "start", "", url];
  } else {
    cmd = "xdg-open";
    args = [url];
  }

  spawnBrowserCommand(cmd, args, { url, platform, stderr });
}

module.exports = {
  openInBrowser,
  buildBrowserOpenErrorMessage,
  spawnBrowserCommand,
};
