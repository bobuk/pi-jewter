/**
 * Live check of the verification hint: ask Jev about labelled run summaries.
 *
 *   node --experimental-strip-types scripts/jev-verify-eval.ts
 *
 * Real network calls with your Jev credentials; may incur charges. Not part of `npm test`.
 * Uses verify.minConfidence from your Jewter config.
 */
import { readFileSync } from "node:fs";
import { loadConfig } from "../src/config.ts";
import { JevClient, resolveTransport } from "../src/jev/client.ts";
import { buildVerifyQuestions, buildVerifyState, decideVerify, type RunFacts } from "../src/verify/core.ts";

interface Case { name: string; expect: ("suggest" | "skip")[]; prompt: string; changedFiles: string[]; commands: { command: string; ok: boolean }[]; tests?: { command: string; ok: boolean }[]; indirectChanges?: string[]; indirectEdits?: number; finalText: string }
const fixture = JSON.parse(readFileSync(new URL("../test/fixtures/jev-verify-eval.json", import.meta.url), "utf8")) as { cases: Case[] };
const config = loadConfig({ cwd: process.cwd() }).config;
const resolved = resolveTransport(config.jev, process.env);
if (!resolved.ok) { console.error(resolved.error); process.exit(1); }
const client = new JevClient({ transport: resolved.transport, timeoutMs: Math.max(config.jev.timeoutMs, 20_000), maxResponseBytes: config.jev.maxResponseBytes });

const results = await Promise.all(fixture.cases.map(async c => {
  const facts: RunFacts = { prompt: c.prompt, changedFiles: c.changedFiles, indirectChanges: c.indirectChanges ?? [], indirectEdits: c.indirectEdits ?? 0, edits: c.changedFiles.length, commands: c.commands, tests: c.tests ?? [], toolErrors: 0, finalText: c.finalText, aborted: false };
  try {
    const d = decideVerify(await client.ask(buildVerifyState(facts), buildVerifyQuestions()), config.verify.minConfidence);
    return { c, outcome: d.suggest ? "suggest" as const : "skip" as const, d };
  } catch (error) {
    return { c, error: error instanceof Error ? error.message : String(error) };
  }
}));

let ok = 0, falseHints = 0, missed = 0, errors = 0, labelled = 0;
for (const r of results) {
  if ("error" in r) { errors++; console.log(`ERR  ${r.c.name}: ${r.error}`); continue; }
  const good = r.c.expect.includes(r.outcome);
  const strict = r.c.expect.length === 1;
  if (strict) { labelled++; if (good) ok++; else if (r.outcome === "suggest") falseHints++; else missed++; }
  console.log(`${good ? "ok  " : "MISS"} ${r.c.name.padEnd(40)} ${r.outcome.padEnd(7)} Jev ${r.d.choice ?? "—"} ${(r.d.confidence * 100).toFixed(0)}%  expect ${r.c.expect.join("/")}`);
}
console.log(`\nJev ${resolved.transport.label} · ${resolved.transport.model} · threshold ${config.verify.minConfidence}`);
console.log(`labelled ${ok}/${labelled} · false hints ${falseHints} · missed ${missed} · errors ${errors}`);
