import test from "node:test";
import assert from "node:assert/strict";
import { defaultConfig } from "../src/config.ts";
import { createRoute } from "../src/router/virtual.ts";
import type { ExtensionContext, ModelRouteRequest } from "@earendil-works/pi-coding-agent";
import type { RouterState, RoutingRecord } from "../src/router/state.ts";

const fast = {provider:"openrouter",id:"fast",api:"openai-completions",reasoning:true};
const strong = {provider:"openrouter",id:"strong",api:"openai-completions",reasoning:true};
const ctx = {modelRegistry:{getAvailable:()=>[fast,strong]}} as unknown as ExtensionContext;
const config = defaultConfig(); config.tiers.medium.model = "openrouter/fast"; config.tiers.strong.model = "openrouter/strong";
const req = (reason: string, extras: object = {}) => ({reason,model:{provider:"jewter",id:"auto"},thinkingLevel:"high",messages:[{role:"user",content:[{type:"text",text:"plan"}]}],...extras}) as unknown as ModelRouteRequest<RouterState>;
const answer = {answers:{role:{choice:"planning",confidence:0.99,probabilities:{planning:0.99}},complexity:{score:0.9,confidence:0.9}}};

test("user request classifies and routes to role tier", async () => {
  const records: RoutingRecord[] = []; let calls=0;
  const route=createRoute({getContext:()=>ctx,getConfig:()=>config,observe:r=>records.push(r),classify:async()=>{calls++;return {response:answer,transport:"fake"};}});
  const selected=await route(req("user")); assert.equal(selected.model.id,"strong"); assert.equal(selected.state?.role,"planning"); assert.equal(records[0]?.status,"switch"); assert.equal(calls,1);
});
test("continuation and retry stick without classifier", async () => {
  let calls=0; const route=createRoute({getContext:()=>ctx,getConfig:()=>config,observe:()=>{},classify:async()=>{calls++;return {response:answer,transport:"fake"};}});
  const selected=await route(req("continuation",{previous:{model:fast,thinkingLevel:"low"}})); assert.equal(selected.model.id,"fast");assert.equal(selected.thinkingLevel,"low");assert.equal(calls,0);
});
test("classifier failure keeps previous, first turn uses configured fallback", async () => {
  const records: RoutingRecord[]=[];const route=createRoute({getContext:()=>ctx,getConfig:()=>config,observe:r=>records.push(r),classify:async()=>{throw new Error("timeout");}});
  assert.equal((await route(req("user",{previous:{model:strong,thinkingLevel:"high"}}))).model.id,"strong");
  assert.equal((await route(req("user"))).model.id,"fast"); assert.match(records[0]?.reason??"",/timeout/);
});
test("absence of any previous or available fallback reports actionable error", async () => {
  const empty=defaultConfig();const route=createRoute({getContext:()=>ctx,getConfig:()=>empty,observe:()=>{},classify:async()=>{throw new Error("offline");}});
  await assert.rejects(()=>route(req("user")),/Configure at least one tier/);
});
