import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionContext, ModelRouteRequest } from "@earendil-works/pi-coding-agent";
import { defaultConfig } from "../src/config.ts";
import { decide } from "../src/jev/decide.ts";
import { createRoute } from "../src/router/virtual.ts";
import type { RouterState, RoutingRecord } from "../src/router/state.ts";
import { statusText } from "../src/ui/status.ts";

const response = { answers: { role: { choice:"review", confidence:1, probabilities:{review:1} }, complexity:{score:1.3, confidence:0.52, legend:{0:"trivial",1:"moderate",2:"complex"}} } };

test("record shows that medium was a fallback, not a confident complexity", () => {
  const decision=decide({response,config:defaultConfig()});
  assert.equal(decision.score,0.65);assert.equal(decision.scoreConfidence,0.52);
  assert.match(statusText({at:"",status:"switch",elapsedMs:1,role:"review",tier:"medium",model:"p/new",thinking:"high",decision}),/tier: default/);
});

test("model change for same classified role and tier is not skipped", async () => {
  const cfg=defaultConfig();cfg.tiers.medium={model:"p/new",thinking:"high"};
  const old={provider:"p",id:"old",api:"fake",reasoning:true}; const next={provider:"p",id:"new",api:"fake",reasoning:true};
  const ctx={modelRegistry:{getAvailable:()=>[old,next]}} as unknown as ExtensionContext;
  const records: RoutingRecord[]=[];
  const route=createRoute({getContext:()=>ctx,getConfig:()=>cfg,observe:r=>records.push(r),classify:async()=>({response,transport:"fake"})});
  const result=await route({reason:"user",model:{provider:"jewter",id:"auto"},thinkingLevel:"high",state:{role:"review",tier:"medium",model:"p/old"},previous:{model:old,thinkingLevel:"high"},messages:[{role:"user",content:"review"}]} as unknown as ModelRouteRequest<RouterState>);
  assert.equal(result.model.id,"new");assert.equal(records[0]?.status,"switch");
});

test("uncertain role never becomes a switch even if complexity is uncertain",()=>{
  const bad={answers:{...response.answers,role:{...response.answers.role,confidence:0.1}}};
  const decision=decide({response:bad,config:defaultConfig()});assert.equal(decision.action,"keep");assert.equal(decision.keepReason,"low-confidence");
});

test("previous exchange is bounded and excludes the latest prompt", async () => {
  const { previousExchange } = await import("../src/router/virtual.ts");
  const msgs = [
    { role: "user", content: "plan the migration" },
    { role: "assistant", content: [{ type: "text", text: "A".repeat(1000) + "PLAN-END" + "B".repeat(1000) }] },
    { role: "user", content: "implement it" },
  ] as never;
  const text = previousExchange(msgs)!;
  assert.match(text, /User: plan the migration/);
  assert.doesNotMatch(text, /implement it/);
  assert.ok(text.length < 1700);
  assert.match(text, /B+$/);
  assert.equal(previousExchange([{ role: "user", content: "hi" }] as never), undefined);
});
