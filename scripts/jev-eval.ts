/**
 * Live Jev evaluation: classify labelled prompts with the shipped questions
 * ("after") and the pre-capability questions ("before"), then compare.
 *
 *   node --experimental-strip-types scripts/jev-eval.ts [--json out.json] [--only after]
 *
 * Makes real network calls with your Jev credentials (TYPESAFE_API_KEY or
 * OPENROUTER_API_KEY) and may incur charges. Not part of `npm test`.
 * Uses the roles and thresholds from your Jewter config.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { loadConfig, type JewterConfig } from "../src/config.ts";
import { JevClient, resolveTransport } from "../src/jev/client.ts";
import { buildJevQuestions, buildJevState, decide, type Decision } from "../src/jev/decide.ts";

interface Case { prompt: string; roles: string[]; tiers?: string[] }
type Variant = "before" | "after";

const LEGACY_COMPLEXITY =
  "Rate how demanding the work requested in `prompt` is: level 0 is trivial " +
  "(small questions, quick lookups, single-line mechanical edits), level 2 is complex " +
  "(multi-file changes, subtle debugging, architecture decisions).";
const LEGACY_IMPLEMENTATION = "Writing, changing, or fixing code; running tests and verifications";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const variants: Variant[] = flag("--only") ? [flag("--only") as Variant] : ["before", "after"];

const fixture = JSON.parse(readFileSync(new URL("../test/fixtures/jev-live-eval.json", import.meta.url), "utf8")) as { cases: Case[] };
const config = loadConfig({ cwd: process.cwd() }).config;
const resolved = resolveTransport(config.jev, process.env);
if (!resolved.ok) { console.error(resolved.error); process.exit(1); }
const client = new JevClient({ transport: resolved.transport, timeoutMs: Math.max(config.jev.timeoutMs, 20_000) });

function variantConfig(variant: Variant): JewterConfig {
  if (variant === "after") return config;
  const legacy = structuredClone(config);
  delete legacy.roles.verification;
  if (legacy.roles.implementation) legacy.roles.implementation.description = LEGACY_IMPLEMENTATION;
  return legacy;
}

/** Before the verification role existed, implementation was the right answer for it. */
const accepted = (c: Case, variant: Variant) => variant === "before" ? c.roles.map(r => r === "verification" ? "implementation" : r) : c.roles;

async function classify(c: Case, variant: Variant): Promise<Decision | string> {
  const cfg = variantConfig(variant);
  const questions = buildJevQuestions(cfg);
  if (variant === "before") questions.complexity = { ...questions.complexity!, instructions: LEGACY_COMPLEXITY };
  try {
    return decide({ response: await client.ask(buildJevState(c.prompt), questions), config: cfg });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function pool<T, R>(items: T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) { const i = next++; out[i] = await run(items[i]!); }
  }));
  return out;
}

const jobs = fixture.cases.flatMap(c => variants.map(variant => ({ c, variant })));
const results = await pool(jobs, 4, async job => ({ ...job, decision: await classify(job.c, job.variant) }));

const score: Record<Variant, { role: number; tier: number; tierCases: number; errors: number }> = {
  before: { role: 0, tier: 0, tierCases: 0, errors: 0 }, after: { role: 0, tier: 0, tierCases: 0, errors: 0 },
};
const rows: string[] = [];
for (const c of fixture.cases) {
  const cells = variants.map(variant => {
    const d = results.find(r => r.c === c && r.variant === variant)!.decision;
    const s = score[variant];
    if (typeof d === "string") { s.errors++; return `ERR ${d.slice(0, 30)}`; }
    const role = d.role ?? "—";
    const roleOk = accepted(c, variant).includes(role);
    if (roleOk) s.role++;
    let tierMark = "";
    if (c.tiers && d.action === "switch") {
      s.tierCases++;
      const ok = c.tiers.includes(d.tier);
      if (ok) s.tier++;
      tierMark = ok ? "" : "✗";
    }
    const tier = d.action === "switch" ? `/${d.tier}${tierMark}` : ` (${d.keepReason})`;
    return `${roleOk ? "" : "✗"}${role}${tier} ${(d.roleConfidence * 100).toFixed(0)}%`;
  });
  rows.push(`${c.prompt.slice(0, 58).padEnd(58)} | ${c.roles.join("/")}${c.tiers ? ` · ${c.tiers.join("/")}` : ""}\n${"".padEnd(58)} | ${cells.map((cell, i) => `${variants[i]}: ${cell}`).join("   ")}`);
}
console.log(`Jev ${resolved.transport.label} · ${resolved.transport.model} · ${fixture.cases.length} prompts\n`);
console.log(rows.join("\n"));
console.log("");
for (const variant of variants) {
  const s = score[variant];
  console.log(`${variant.padEnd(6)} role ${s.role}/${fixture.cases.length} · tier ${s.tier}/${s.tierCases} (switched cases with a label) · errors ${s.errors}`);
}

const out = flag("--json");
if (out) {
  writeFileSync(out, JSON.stringify(results.map(r => ({ prompt: r.c.prompt, variant: r.variant, expected: { roles: r.c.roles, tiers: r.c.tiers }, decision: r.decision })), null, 2));
  console.log(`\nSaved ${out}`);
}
