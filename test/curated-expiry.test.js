const test = require("node:test");
const assert = require("node:assert");

const { checkExpiries, parseExpiryMs } = require("../scripts/validate-curated-expiry.cjs");
const curated = require("../src/lib/pricing/curated-overrides.json");

const AT = (iso) => Date.parse(`${iso}T00:00:00Z`);

const VALID_ENTRY = {
  id: "sample",
  expires_at: "2026-08-31",
  what: "Intro price reverts to sticker.",
  action: "Re-vendor the seed, then delete this entry.",
};

test("passes while the expiry is still in the future", () => {
  const { errors, checked } = checkExpiries({ expiries: [VALID_ENTRY] }, AT("2026-08-30"));
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(checked, 1);
});

test("fails from UTC midnight of the expiry date (boundary is inclusive)", () => {
  const { errors } = checkExpiries({ expiries: [VALID_ENTRY] }, AT("2026-08-31"));
  assert.strictEqual(errors.length, 1);
  assert.match(errors[0], /EXPIRED 2026-08-31 \(0 day\(s\) ago\)/);
});

test("an expired entry reports the action so the fix is in the failure output", () => {
  const { errors } = checkExpiries({ expiries: [VALID_ENTRY] }, AT("2026-09-10"));
  assert.strictEqual(errors.length, 1);
  assert.match(errors[0], /'sample'/);
  assert.match(errors[0], /10 day\(s\) ago/);
  assert.match(errors[0], /Re-vendor the seed/);
});

test("rejects a missing or blank required field", () => {
  for (const field of ["id", "expires_at", "what", "action"]) {
    const entry = { ...VALID_ENTRY, [field]: "   " };
    const { errors } = checkExpiries({ expiries: [entry] }, AT("2026-01-01"));
    assert.ok(
      errors.some((e) => e.includes(`'${field}' is required`)),
      `expected a required-field error for ${field}, got ${JSON.stringify(errors)}`,
    );
  }
});

test("rejects a malformed or impossible date", () => {
  for (const bad of ["2026-8-31", "31/08/2026", "2026-02-31", "soon", ""]) {
    const { errors } = checkExpiries(
      { expiries: [{ ...VALID_ENTRY, expires_at: bad }] },
      AT("2026-01-01"),
    );
    assert.ok(
      errors.some((e) => e.includes("YYYY-MM-DD")),
      `expected a date error for ${JSON.stringify(bad)}, got ${JSON.stringify(errors)}`,
    );
  }
});

test("rejects duplicate ids", () => {
  const { errors } = checkExpiries(
    { expiries: [VALID_ENTRY, { ...VALID_ENTRY }] },
    AT("2026-01-01"),
  );
  assert.ok(errors.some((e) => e.includes("duplicate id 'sample'")));
});

test("rejects a regression to free-text *_expiry keys", () => {
  const { errors } = checkExpiries(
    { some_promo_expiry: "2026-05-31 — remember to update this", expiries: [] },
    AT("2026-01-01"),
  );
  assert.strictEqual(errors.length, 1);
  assert.match(errors[0], /free-text expiry keys are not checked/);
});

test("expiries_note is allowed even though it ends in a checked-looking word", () => {
  const { errors } = checkExpiries({ expiries_note: "how this works", expiries: [] }, AT("2026-01-01"));
  assert.deepStrictEqual(errors, []);
});

test("an absent expiries array is fine; a non-array is not", () => {
  assert.deepStrictEqual(checkExpiries({}, AT("2026-01-01")).errors, []);
  assert.ok(
    checkExpiries({ expiries: "2026-08-31" }, AT("2026-01-01")).errors.some((e) =>
      e.includes("must be an array"),
    ),
  );
});

test("a non-object entry is reported rather than crashing", () => {
  const { errors } = checkExpiries({ expiries: ["2026-08-31", null] }, AT("2026-01-01"));
  assert.strictEqual(errors.length, 2);
  errors.forEach((e) => assert.match(e, /must be an object/));
});

test("parseExpiryMs pins to UTC midnight regardless of the local timezone", () => {
  assert.strictEqual(parseExpiryMs("2026-08-31"), Date.UTC(2026, 7, 31));
  assert.strictEqual(parseExpiryMs("nope"), null);
});

test("the real curated-overrides.json has no expired entries today", () => {
  const { errors } = checkExpiries(curated._meta, Date.now());
  assert.deepStrictEqual(errors, [], errors.join("\n"));
});

test("deepseek-v4-pro carries post-promo pricing, not the expired 75%-off rates", () => {
  // Regression guard for issue #87: the promo rates were input 0.435 / output 0.87.
  const pro = curated.exact["deepseek-v4-pro"];
  assert.strictEqual(pro.input, 1.74);
  assert.strictEqual(pro.output, 3.48);
  assert.strictEqual(pro.cache_read, 0.0145);
  assert.strictEqual(pro.cache_write, 1.74);
});
