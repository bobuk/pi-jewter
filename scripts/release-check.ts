/**
 * Release gate for .github/workflows/release.yml.
 *
 *   node --experimental-strip-types scripts/release-check.ts <tag> [--prerelease]
 *
 * Checks that the tag matches package.json, that CHANGELOG.md has a section for
 * the version, and compares with what the npm registry already has. Writes
 * `publish`, `version` and `dist_tag` to $GITHUB_OUTPUT when it is set.
 * Exits non-zero when publishing would be wrong; skipping an already published
 * version is a success, so re-running a release is harmless.
 */
import { appendFileSync, readFileSync } from "node:fs";

export interface RegistryState {
  versions: string[];
  latest?: string;
}

export interface ReleaseInput {
  tag: string;
  version: string;
  changelog: string;
  /** Whether the GitHub release is marked as a pre-release. */
  prerelease: boolean;
  registry: RegistryState;
}

export type ReleasePlan =
  | { ok: true; publish: true; version: string; distTag: "latest" | "next" }
  | { ok: true; publish: false; version: string; reason: string }
  | { ok: false; error: string };

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

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

export function planRelease(input: ReleaseInput): ReleasePlan {
  const { tag, version, changelog, prerelease, registry } = input;
  if (!SEMVER.test(version)) return { ok: false, error: `package.json version "${version}" is not x.y.z or x.y.z-pre` };
  if (tag !== `v${version}`) return { ok: false, error: `tag "${tag}" does not match package.json version (expected "v${version}")` };
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`^## \\[${escaped}\\]`, "m").test(changelog)) {
    return { ok: false, error: `CHANGELOG.md has no "## [${version}]" section; move the Unreleased entries there first` };
  }
  const isPre = version.includes("-");
  if (prerelease && !isPre) return { ok: false, error: `release is marked pre-release but ${version} is a stable version; use a version like ${version}-rc.1` };
  if (!prerelease && isPre) return { ok: false, error: `${version} is a pre-release version; mark the GitHub release as a pre-release` };
  if (registry.versions.includes(version)) return { ok: true, publish: false, version, reason: `${version} is already on npm` };
  if (!isPre && registry.latest && compareVersions(version, registry.latest) < 0) {
    return { ok: false, error: `${version} is lower than npm latest ${registry.latest}; publish backports manually with an explicit dist-tag` };
  }
  return { ok: true, publish: true, version, distTag: isPre ? "next" : "latest" };
}

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
  const args = process.argv.slice(2);
  const tag = args.find(a => !a.startsWith("--"));
  if (!tag) throw new Error("usage: release-check.ts <tag> [--prerelease]");
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { name: string; version: string };
  const plan = planRelease({
    tag,
    version: pkg.version,
    changelog: readFileSync("CHANGELOG.md", "utf8"),
    prerelease: args.includes("--prerelease"),
    registry: await fetchRegistry(pkg.name),
  });
  if (!plan.ok) {
    console.error(`::error::${plan.error}`);
    process.exitCode = 1;
    return;
  }
  const lines = plan.publish
    ? [`publish=true`, `version=${plan.version}`, `dist_tag=${plan.distTag}`]
    : [`publish=false`, `version=${plan.version}`];
  console.log(plan.publish ? `Publishing ${pkg.name}@${plan.version} with dist-tag ${plan.distTag}` : `Skipping: ${plan.reason}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
