/**
 * Helpers for ./release.sh. Not part of the published package.
 *
 *   node --experimental-strip-types scripts/release.ts check X.Y.Z
 *     Validates the version against package.json, CHANGELOG.md and the npm
 *     registry. Prints the npm dist-tag (`latest` or `next`) on success.
 *   node --experimental-strip-types scripts/release.ts changelog X.Y.Z
 *     Moves the Unreleased entries under `## [X.Y.Z]` and leaves an empty
 *     Unreleased section above it.
 *   node --experimental-strip-types scripts/release.ts notes X.Y.Z
 *     Prints the CHANGELOG.md section for X.Y.Z (GitHub Release notes).
 *   node --experimental-strip-types scripts/release.ts unreleased
 *     Prints the Unreleased entries (empty output when there are none).
 *   node --experimental-strip-types scripts/release.ts fill
 *     Replaces the Unreleased entries with the text read from stdin.
 *   node --experimental-strip-types scripts/release.ts next
 *     Prints the next patch version after package.json.
 *   node --experimental-strip-types scripts/release.ts published X.Y.Z
 *     Prints `yes` when npm already has X.Y.Z, otherwise `no`.
 *   node --experimental-strip-types scripts/release.ts disttag X.Y.Z
 *     Prints the npm dist-tag for X.Y.Z (`next` for pre-releases).
 */
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface RegistryState {
  versions: string[];
  latest?: string;
}

export type CheckResult = { ok: true; distTag: "latest" | "next" } | { ok: false; error: string };

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const UNRELEASED = /^## \[Unreleased\][^\n]*\n/m;

/** Semver precedence for x.y.z[-pre]; build metadata is not used by this package. */
export function compareVersions(a: string, b: string): number {
  const pa = SEMVER.exec(a), pb = SEMVER.exec(b);
  if (!pa || !pb) throw new Error(`not a semver version: ${pa ? b : a}`);
  for (let i = 1; i <= 3; i++) {
    const diff = Number(pa[i]) - Number(pb[i]);
    if (diff) return Math.sign(diff);
  }
  const [preA, preB] = [pa[4], pb[4]];
  if (preA === preB) return 0;
  if (preA === undefined) return 1; // A release ranks above its pre-releases.
  if (preB === undefined) return -1;
  const ia = preA.split("."), ib = preB.split(".");
  for (let i = 0; i < Math.max(ia.length, ib.length); i++) {
    const x = ia[i], y = ib[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny && Number(x) !== Number(y)) return Math.sign(Number(x) - Number(y));
    if (nx !== ny) return nx ? -1 : 1;
    if (!nx && x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Entries between `## [Unreleased]` and the next `## ` heading. */
export function unreleasedEntries(changelog: string): string | undefined {
  const match = UNRELEASED.exec(changelog);
  if (!match) return undefined;
  const rest = changelog.slice(match.index + match[0].length);
  const next = rest.search(/^## /m);
  return (next < 0 ? rest : rest.slice(0, next)).trim();
}

export function checkRelease(input: { version: string; current: string; changelog: string; registry: RegistryState }): CheckResult {
  const { version, current, changelog, registry } = input;
  if (!SEMVER.test(version)) return { ok: false, error: `"${version}" is not a version like 1.2.3 or 1.2.3-rc.1` };
  if (compareVersions(version, current) <= 0) return { ok: false, error: `${version} is not higher than the package.json version ${current}` };
  if (new RegExp(`^## \\[${escape(version)}\\]`, "m").test(changelog)) return { ok: false, error: `CHANGELOG.md already has a "## [${version}]" section` };
  const entries = unreleasedEntries(changelog);
  if (entries === undefined) return { ok: false, error: `CHANGELOG.md has no "## [Unreleased]" section` };
  if (!entries) return { ok: false, error: `the Unreleased section of CHANGELOG.md is empty; describe the release first` };
  if (registry.versions.includes(version)) return { ok: false, error: `${version} is already published on npm` };
  const pre = version.includes("-");
  if (!pre && registry.latest && compareVersions(version, registry.latest) <= 0) {
    return { ok: false, error: `${version} is not higher than npm latest ${registry.latest}` };
  }
  return { ok: true, distTag: pre ? "next" : "latest" };
}

/** Rename Unreleased to the version and open a fresh, empty Unreleased section. */
export function promoteChangelog(changelog: string, version: string): string {
  if (!UNRELEASED.test(changelog)) throw new Error(`CHANGELOG.md has no "## [Unreleased]" section`);
  return changelog.replace(UNRELEASED, `## [Unreleased]\n\n## [${version}]\n`);
}

/** The body of `## [version]`, without its heading, or undefined when absent. */
export function releaseNotes(changelog: string, version: string): string | undefined {
  const match = new RegExp(`^## \\[${escape(version)}\\][^\\n]*\\n`, "m").exec(changelog);
  if (!match) return undefined;
  const rest = changelog.slice(match.index + match[0].length);
  const next = rest.search(/^## /m);
  return (next < 0 ? rest : rest.slice(0, next)).trim();
}

/** Replace the Unreleased entries with `entries`, keeping every other section. */
export function fillUnreleased(changelog: string, entries: string): string {
  const match = UNRELEASED.exec(changelog);
  if (!match) throw new Error(`CHANGELOG.md has no "## [Unreleased]" section`);
  const start = match.index + match[0].length;
  const rest = changelog.slice(start);
  const next = rest.search(/^## /m);
  const tail = next < 0 ? "" : rest.slice(next);
  const body = entries.trim();
  return `${changelog.slice(0, start)}\n${body ? `${body}\n\n` : ""}${tail}`;
}

/** Next patch version: 1.2.3 -> 1.2.4, 1.2.3-rc.1 -> 1.2.3. */
export function nextPatch(current: string): string {
  const match = SEMVER.exec(current);
  if (!match) throw new Error(`not a semver version: ${current}`);
  if (match[4] !== undefined) return `${match[1]}.${match[2]}.${match[3]}`;
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

export const distTagFor = (version: string): "latest" | "next" => version.includes("-") ? "next" : "latest";

/** Registry state for a package; a 404 means it has never been published. */
export async function fetchRegistry(name: string, fetchImpl: typeof fetch = fetch): Promise<RegistryState> {
  const response = await fetchImpl(`https://registry.npmjs.org/${encodeURIComponent(name).replace("%40", "@")}`, {
    headers: { accept: "application/vnd.npm.install-v1+json" },
  });
  if (response.status === 404) return { versions: [] };
  if (!response.ok) throw new Error(`npm registry responded ${response.status} for ${name}`);
  const data = await response.json() as { versions?: Record<string, unknown>; "dist-tags"?: Record<string, string> };
  return { versions: Object.keys(data.versions ?? {}), latest: data["dist-tags"]?.latest };
}

async function main(): Promise<void> {
  const [command, version] = process.argv.slice(2);
  const needsVersion = new Set(["check", "changelog", "notes", "published", "disttag"]);
  const known = new Set([...needsVersion, "unreleased", "fill", "next"]);
  if (!command || !known.has(command) || (needsVersion.has(command) && !version)) {
    throw new Error("usage: release.ts check|changelog|notes|published|disttag X.Y.Z, or release.ts unreleased|fill|next");
  }
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { name: string; version: string };
  const changelog = () => readFileSync("CHANGELOG.md", "utf8");
  switch (command) {
    case "changelog": writeFileSync("CHANGELOG.md", promoteChangelog(changelog(), version!)); return;
    case "unreleased": { const entries = unreleasedEntries(changelog()); if (entries) console.log(entries); return; }
    case "fill": writeFileSync("CHANGELOG.md", fillUnreleased(changelog(), readFileSync(0, "utf8"))); return;
    case "next": console.log(nextPatch(pkg.version)); return;
    case "disttag": console.log(distTagFor(version!)); return;
    case "notes": {
      const notes = releaseNotes(changelog(), version!);
      if (notes === undefined) throw new Error(`CHANGELOG.md has no "## [${version}]" section`);
      console.log(notes);
      return;
    }
    case "published": console.log((await fetchRegistry(pkg.name)).versions.includes(version!) ? "yes" : "no"); return;
  }
  const result = checkRelease({ version: version!, current: pkg.version, changelog: changelog(), registry: await fetchRegistry(pkg.name) });
  if (!result.ok) throw new Error(result.error);
  console.log(result.distTag);
}

/** True when this file is the script being run. Compares real paths: import.meta.url is URL-encoded and symlink-resolved, argv[1] is neither. */
export function isMain(metaUrl: string, argv1: string | undefined): boolean {
  if (!argv1) return false;
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(argv1);
  } catch {
    return false;
  }
}

if (isMain(import.meta.url, process.argv[1])) {
  main().catch(error => {
    console.error(`release: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
