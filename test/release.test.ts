import test from "node:test";
import assert from "node:assert/strict";
import { compareVersions, fetchRegistry, planRelease, type ReleaseInput } from "../scripts/release-check.ts";

const changelog = "# Changelog\n\n## [Unreleased]\n\n## [0.3.0]\n\n- x\n\n## [0.3.1-rc.1]\n\n## [0.2.0]\n";
const input = (over: Partial<ReleaseInput> = {}): ReleaseInput => ({
  tag: "v0.3.0", version: "0.3.0", changelog, prerelease: false, registry: { versions: [] }, ...over,
});

test("semver precedence covers releases and pre-releases", () => {
  assert.equal(compareVersions("0.3.0", "0.2.9"), 1);
  assert.equal(compareVersions("0.10.0", "0.9.0"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0-rc.1"), 1);
  assert.equal(compareVersions("1.0.0-rc.2", "1.0.0-rc.10"), -1);
  assert.equal(compareVersions("1.0.0-alpha", "1.0.0-alpha.1"), -1);
  assert.equal(compareVersions("1.0.0-1", "1.0.0-alpha"), -1);
  assert.equal(compareVersions("2.0.0", "2.0.0"), 0);
  assert.throws(() => compareVersions("v1", "1.0.0"));
});

test("a first release publishes as latest", () => {
  assert.deepEqual(planRelease(input()), { ok: true, publish: true, version: "0.3.0", distTag: "latest" });
});

test("tag, version and changelog must agree", () => {
  assert.match((planRelease(input({ tag: "v0.3.1" })) as { error: string }).error, /expected "v0\.3\.0"/);
  assert.match((planRelease(input({ tag: "0.3.0" })) as { error: string }).error, /does not match/);
  assert.match((planRelease(input({ version: "0.4.0", tag: "v0.4.0" })) as { error: string }).error, /no "## \[0\.4\.0\]"/);
  assert.match((planRelease(input({ version: "latest", tag: "vlatest" })) as { error: string }).error, /not x\.y\.z/);
  // A heading that merely starts with the version is not enough.
  assert.equal(planRelease(input({ changelog: "## [0.3.0.1]\n" })).ok, false);
});

test("pre-releases go to next and must be marked as such", () => {
  const pre = { tag: "v0.3.1-rc.1", version: "0.3.1-rc.1" };
  assert.deepEqual(planRelease(input({ ...pre, prerelease: true })), { ok: true, publish: true, version: "0.3.1-rc.1", distTag: "next" });
  assert.match((planRelease(input(pre)) as { error: string }).error, /mark the GitHub release as a pre-release/);
  assert.match((planRelease(input({ prerelease: true })) as { error: string }).error, /stable version/);
});

test("re-running a published release is a successful skip", () => {
  assert.deepEqual(planRelease(input({ registry: { versions: ["0.3.0"], latest: "0.3.0" } })),
    { ok: true, publish: false, version: "0.3.0", reason: "0.3.0 is already on npm" });
});

test("a stable release lower than npm latest is refused", () => {
  assert.match((planRelease(input({ registry: { versions: ["0.4.0"], latest: "0.4.0" } })) as { error: string }).error, /lower than npm latest 0\.4\.0/);
  assert.equal(planRelease(input({ registry: { versions: ["0.2.0"], latest: "0.2.0" } })).ok, true);
});

test("registry lookup treats 404 as never published and reports other failures", async () => {
  const reply = (status: number, body: unknown = {}) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  assert.deepEqual(await fetchRegistry("pi-jewter", reply(404)), { versions: [] });
  assert.deepEqual(await fetchRegistry("pi-jewter", reply(200, { versions: { "0.3.0": {} }, "dist-tags": { latest: "0.3.0" } })), { versions: ["0.3.0"], latest: "0.3.0" });
  await assert.rejects(fetchRegistry("pi-jewter", reply(503)), /responded 503/);
});
