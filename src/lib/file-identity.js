const crypto = require("node:crypto");
const fssync = require("node:fs");

// Fingerprint the first bytes of a file so rotation is detected even when the
// OS reuses the inode after unlink+recreate (Linux logrotate). Returns "" on
// any error so callers treat "no fingerprint" as "not changed". Also returns
// "" when the file is shorter than the fingerprint window: for a sub-256B
// file that is still being appended to, the window would extend into the
// not-yet-written append zone, so plain growth (not rotation) would shift
// the hash and produce a false "rotated" signal.
function readFileHeadSignature(filePath) {
  try {
    const fd = fssync.openSync(filePath, "r");
    try {
      const buf = Buffer.alloc(256);
      const bytes = fssync.readSync(fd, buf, 0, 256, 0);
      if (bytes < 256) return "";
      return crypto.createHash("sha1").update(buf.subarray(0, bytes)).digest("hex");
    } finally {
      fssync.closeSync(fd);
    }
  } catch {
    return "";
  }
}

// A token that changes whenever a file's contents could have changed. Returns
// null when the path is not a readable regular file, which callers must treat
// as "cannot be reused" rather than "unchanged".
function fileIdentity(filePath) {
  let st = null;
  try {
    st = fssync.statSync(filePath);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  return {
    inode: st.ino || 0,
    size: Number.isFinite(st.size) ? st.size : 0,
    mtimeMs: Number.isFinite(st.mtimeMs) ? st.mtimeMs : 0,
    head: readFileHeadSignature(filePath),
  };
}

// Equality, not ordering. Deliberately not `cur.mtimeMs > prev.mtimeMs`: a
// clock that moves backwards, a restored mtime, or a truncation must all read
// as "changed" and force a re-read. The cost of a false "changed" is a wasted
// parse; the cost of a false "unchanged" is serving stale data forever.
function isUnchanged(prev, cur) {
  if (!prev || !cur) return false;
  // An empty head means the file was too short to fingerprint, so it carries
  // no rotation signal — fall back to inode/size/mtime alone rather than
  // treating "" as a mismatch.
  const headChanged =
    typeof prev.head === "string" && prev.head !== "" && prev.head !== cur.head;
  return (
    prev.inode === cur.inode &&
    prev.size === cur.size &&
    prev.mtimeMs === cur.mtimeMs &&
    !headChanged
  );
}

module.exports = {
  readFileHeadSignature,
  fileIdentity,
  isUnchanged,
};
