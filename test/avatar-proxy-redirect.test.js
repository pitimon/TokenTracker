const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  fetchAvatarFollowingAllowlist,
  isAllowedAvatarTarget,
  AVATAR_REDIRECT_BLOCKED,
} = require("../src/lib/local-api");

const ALLOWLIST = ["githubusercontent.com", "gravatar.com"];

// Minimal stand-in for a fetch Response, enough for the redirect walk.
function reply(status, location) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => (name.toLowerCase() === "location" ? location : null) },
  };
}

function fetcher(script) {
  const seen = [];
  const impl = async (url) => {
    seen.push(url);
    const next = script.shift();
    if (!next) throw new Error(`unexpected request to ${url}`);
    return next;
  };
  impl.seen = seen;
  return impl;
}

test("a redirect off the allowlist is refused, and never requested", async () => {
  // The allowlist was checked once, against the URL the caller asked for, and
  // `redirect: "follow"` then went wherever the response pointed. An allowlisted
  // CDN issuing a redirect — or anyone able to place one there — made this
  // loopback server a way to reach cloud metadata or another local service.
  const impl = fetcher([reply(302, "http://169.254.169.254/latest/meta-data/")]);
  const result = await fetchAvatarFollowingAllowlist(
    "https://avatars.githubusercontent.com/u/1",
    { method: "GET" },
    ALLOWLIST,
    impl,
  );
  assert.equal(result, AVATAR_REDIRECT_BLOCKED);
  assert.deepEqual(impl.seen, ["https://avatars.githubusercontent.com/u/1"], "the target must never be fetched");
});

test("a redirect that stays on the allowlist is followed", async () => {
  const impl = fetcher([reply(301, "https://gravatar.com/avatar/abc"), reply(200)]);
  const result = await fetchAvatarFollowingAllowlist(
    "https://avatars.githubusercontent.com/u/1",
    { method: "GET" },
    ALLOWLIST,
    impl,
  );
  assert.equal(result.status, 200);
  assert.equal(impl.seen.length, 2);
});

test("a relative redirect is resolved against the current URL, not assumed safe", async () => {
  const impl = fetcher([reply(302, "/other.png"), reply(200)]);
  const result = await fetchAvatarFollowingAllowlist(
    "https://gravatar.com/avatar/abc",
    { method: "GET" },
    ALLOWLIST,
    impl,
  );
  assert.equal(result.status, 200);
  assert.equal(impl.seen[1], "https://gravatar.com/other.png");
});

test("a non-http scheme in Location is refused", async () => {
  // file:// and data: would otherwise be handed straight to fetch.
  for (const location of ["file:///etc/passwd", "data:text/html,x"]) {
    const impl = fetcher([reply(302, location)]);
    const result = await fetchAvatarFollowingAllowlist("https://gravatar.com/a", {}, ALLOWLIST, impl);
    assert.equal(result, AVATAR_REDIRECT_BLOCKED, location);
  }
});

test("a redirect to a non-default port on an allowed host is refused, and never requested", async () => {
  // The hostname allowlist alone is not an address allowlist. `gravatar.com:8443`
  // passes any hostname check while pointing at a different service, so an
  // allowlisted CDN could still walk this proxy across ports.
  for (const location of [
    "https://gravatar.com:8443/x",
    "http://gravatar.com:9200/x",
    "//gravatar.com:22/x",
  ]) {
    const impl = fetcher([reply(302, location)]);
    const result = await fetchAvatarFollowingAllowlist(
      "https://avatars.githubusercontent.com/u/1",
      { method: "GET" },
      ALLOWLIST,
      impl,
    );
    assert.equal(result, AVATAR_REDIRECT_BLOCKED, location);
    assert.deepEqual(
      impl.seen,
      ["https://avatars.githubusercontent.com/u/1"],
      `${location} must never be fetched`,
    );
  }
});

test("the scheme's default port is still accepted, written either way", async () => {
  // The guard rejects a non-empty `port`, and `new URL` empties it for the
  // default — so an explicit :443 must not be mistaken for a port change.
  for (const location of ["https://gravatar.com:443/x", "https://gravatar.com/x"]) {
    const impl = fetcher([reply(301, location), reply(200)]);
    const result = await fetchAvatarFollowingAllowlist(
      "https://avatars.githubusercontent.com/u/1",
      { method: "GET" },
      ALLOWLIST,
      impl,
    );
    assert.equal(result.status, 200, location);
    assert.equal(impl.seen[1], "https://gravatar.com/x");
  }
});

test("the entry-point guard and the redirect guard are the same check", async () => {
  // Both call sites go through isAllowedAvatarTarget, so a target refused at one
  // cannot be reached through the other.
  const refused = [
    "https://gravatar.com:8443/x",
    "http://169.254.169.254/latest/meta-data/",
    "https://gravatar.com.evil.example/x",
    "https://evil-gravatar.com/x",
    "file:///etc/passwd",
  ];
  for (const target of refused) {
    assert.equal(isAllowedAvatarTarget(new URL(target), ALLOWLIST), false, target);
  }
  for (const target of ["https://gravatar.com/x", "https://avatars.githubusercontent.com/u/1"]) {
    assert.equal(isAllowedAvatarTarget(new URL(target), ALLOWLIST), true, target);
  }
});

test("a redirect loop terminates instead of hanging", async () => {
  const impl = fetcher(Array.from({ length: 10 }, () => reply(302, "https://gravatar.com/loop")));
  const result = await fetchAvatarFollowingAllowlist("https://gravatar.com/a", {}, ALLOWLIST, impl);
  assert.equal(result, AVATAR_REDIRECT_BLOCKED);
  assert.ok(impl.seen.length <= 5, `too many hops: ${impl.seen.length}`);
});
