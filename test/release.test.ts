import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { checkRelease, compareVersions, distTagFor, fetchRegistry, fillUnreleased, isMain, nextPatch, promoteChangelog, releaseNotes, unreleasedEntries } from "../scripts/release.ts";

const changelog = "# Changelog\n\n## [Unreleased]\n\n- Added verification hints.\n\n## [0.2.0]\n\n- Menu.\n";
const check = (over: Partial<Parameters<typeof checkRelease>[0]> = {}) =>
  checkRelease({ version: "0.3.0", current: "0.2.0", changelog, registry: { versions: [] }, ...over });
const error = (result: ReturnType<typeof checkRelease>) => (result as { error: string }).error;

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

test("a first release goes to latest, a pre-release to next", () => {
  assert.deepEqual(check(), { ok: true, distTag: "latest" });
  assert.deepEqual(check({ version: "0.3.0-rc.1" }), { ok: true, distTag: "next" });
});

test("the version must be valid and above package.json", () => {
  for (const version of ["v0.3.0", "0.3", "0.3.0.1", "latest", "0.3.0-", "0.3.0-rc..1", "0.3.0 "]) {
    assert.match(error(check({ version })), /is not a version/, version);
  }
  assert.match(error(check({ version: "0.2.0" })), /not higher than the package\.json version 0\.2\.0/);
  assert.match(error(check({ version: "0.1.9" })), /not higher/);
  assert.match(error(check({ version: "0.2.0-rc.1" })), /not higher/);
});

test("the changelog needs non-empty Unreleased entries and no existing section", () => {
  assert.match(error(check({ changelog: "## [0.2.0]\n" })), /no "## \[Unreleased\]"/);
  assert.match(error(check({ changelog: "## [Unreleased]\n\n## [0.2.0]\n- x\n" })), /Unreleased section of CHANGELOG\.md is empty/);
  assert.match(error(check({ changelog: "## [Unreleased]\n- y\n\n## [0.3.0]\n- x\n" })), /already has a "## \[0\.3\.0\]"/);
  // A heading that merely starts with the version is a different release.
  assert.equal(check({ changelog: "## [Unreleased]\n- y\n\n## [0.3.0.1]\n" }).ok, true);
});

test("the npm registry must not have the version or a higher latest", () => {
  assert.match(error(check({ registry: { versions: ["0.3.0"], latest: "0.3.0" } })), /already published/);
  assert.match(error(check({ registry: { versions: ["0.4.0"], latest: "0.4.0" } })), /not higher than npm latest 0\.4\.0/);
  assert.equal(check({ registry: { versions: ["0.2.5"], latest: "0.2.5" } }).ok, true);
  // A pre-release below latest goes to `next` and does not move latest.
  assert.deepEqual(check({ version: "0.3.0-rc.1", registry: { versions: ["0.4.0"], latest: "0.4.0" } }), { ok: true, distTag: "next" });
});

test("promoting the changelog moves Unreleased entries under the version", () => {
  const next = promoteChangelog(changelog, "0.3.0");
  assert.equal(next, "# Changelog\n\n## [Unreleased]\n\n## [0.3.0]\n\n- Added verification hints.\n\n## [0.2.0]\n\n- Menu.\n");
  assert.equal(unreleasedEntries(next), "");
  assert.equal(unreleasedEntries(changelog), "- Added verification hints.");
  assert.equal(unreleasedEntries("## [Unreleased]\n- last section\n"), "- last section");
  assert.throws(() => promoteChangelog("## [0.2.0]\n", "0.3.0"), /no "## \[Unreleased\]"/);
});

test("the CLI entry check survives spaces, non-ASCII and symlinked paths", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "jewter-release-")), "dir with space é");
  mkdirSync(dir);
  const file = join(dir, "release.ts");
  writeFileSync(file, "");
  const link = join(dir, "..", "link");
  symlinkSync(dir, link);
  assert.equal(isMain(pathToFileURL(file).href, file), true);
  assert.equal(isMain(pathToFileURL(file).href, join(link, "release.ts")), true);
  assert.equal(isMain(pathToFileURL(file).href, join(dir, "other.ts")), false);
  assert.equal(isMain(pathToFileURL(file).href, undefined), false);
});

test("registry lookup treats 404 as never published and reports other failures", async () => {
  const reply = (status: number, body: unknown = {}) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  assert.deepEqual(await fetchRegistry("pi-jewter", reply(404)), { versions: [] });
  assert.deepEqual(await fetchRegistry("pi-jewter", reply(200, { versions: { "0.3.0": {} }, "dist-tags": { latest: "0.3.0" } })), { versions: ["0.3.0"], latest: "0.3.0" });
  await assert.rejects(fetchRegistry("pi-jewter", reply(503)), /responded 503/);
  let url = "";
  await fetchRegistry("@scope/pkg", (async (u: string) => { url = u; return new Response("{}", { status: 404 }); }) as unknown as typeof fetch);
  assert.equal(url, "https://registry.npmjs.org/@scope%2Fpkg");
});

test("release notes are the body of one version section", () => {
  const log = "# Changelog\n\n## [Unreleased]\n\n## [0.3.1]\n\n- Added psst.\n\n## [0.3.0]\n\n- Older.\n";
  assert.equal(releaseNotes(log, "0.3.1"), "- Added psst.");
  assert.equal(releaseNotes(log, "0.3.0"), "- Older.");
  assert.equal(releaseNotes(log, "0.3"), undefined);
  assert.equal(releaseNotes(log, "0.2.0"), undefined);
});

test("filling Unreleased replaces only its entries", () => {
  const empty = "# Changelog\n\n## [Unreleased]\n\n## [0.2.0]\n\n- Menu.\n";
  const filled = fillUnreleased(empty, "- Added A.\n- Fixed B.\n");
  assert.equal(filled, "# Changelog\n\n## [Unreleased]\n\n- Added A.\n- Fixed B.\n\n## [0.2.0]\n\n- Menu.\n");
  assert.equal(unreleasedEntries(filled), "- Added A.\n- Fixed B.");
  assert.equal(fillUnreleased(filled, "- Only C."), "# Changelog\n\n## [Unreleased]\n\n- Only C.\n\n## [0.2.0]\n\n- Menu.\n");
  assert.equal(fillUnreleased("## [Unreleased]\n- old\n", "- new"), "## [Unreleased]\n\n- new\n\n");
  assert.throws(() => fillUnreleased("## [0.2.0]\n", "- x"), /no "## \[Unreleased\]"/);
});

test("next patch and dist-tag follow semver", () => {
  assert.equal(nextPatch("0.3.0"), "0.3.1");
  assert.equal(nextPatch("0.3.9"), "0.3.10");
  assert.equal(nextPatch("1.0.0-rc.2"), "1.0.0");
  assert.throws(() => nextPatch("v1"));
  assert.equal(distTagFor("0.3.1"), "latest");
  assert.equal(distTagFor("1.0.0-rc.1"), "next");
});
