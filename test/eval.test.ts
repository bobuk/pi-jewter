import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defaultConfig } from "../src/config.ts";
import { decide } from "../src/jev/decide.ts";
import type { JevResponse } from "../src/jev/types.ts";

interface Case { prompt: string; answers: JevResponse["answers"]; expect: Record<string, string> }
const fixture = JSON.parse(readFileSync(new URL("./fixtures/jev-calibration.json", import.meta.url), "utf8")) as { cases: Case[] };

for (const c of fixture.cases) {
  test(`calibration: ${c.prompt}`, () => {
    const decision = decide({ response: { answers: c.answers }, config: defaultConfig() }) as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(c.expect)) assert.equal(decision[key], value, `${key} for "${c.prompt}"`);
  });
}
