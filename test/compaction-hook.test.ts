import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defaultConfig } from "../src/config.ts";
import { registerCompaction } from "../src/compaction/extension.ts";

test("compaction hook uses LLM for uncertain Jev and returns Pi boundary and usage", async () => {
  let handler: Function | undefined;
  const pi = { on: (_event: string, fn: Function) => { handler=fn; } } as unknown as ExtensionAPI;
  const config=defaultConfig(); config.compaction.enabled=true;config.compaction.minResultChars=400;config.compaction.retainedChars=100;config.compaction.minReduction=0.01;config.tiers.fast.model="openrouter/fast";
  registerCompaction(pi,()=>config);
  const originalFetch=globalThis.fetch; const oldKey=process.env.TYPESAFE_API_KEY; const oldOr=process.env.OPENROUTER_API_KEY;
  let prompts=0;process.env.TYPESAFE_API_KEY="fake";delete process.env.OPENROUTER_API_KEY;
  globalThis.fetch=async()=>new Response(JSON.stringify({answers:{r1:{choice:"shorten",confidence:0.55,probabilities:{shorten:0.55}}}}),{status:200});
  const usage={input:10,output:5,cacheRead:0,cacheWrite:0,totalTokens:15,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
  const ctx={hasUI:false,ui:{notify:()=>{}},modelRegistry:{getAvailable:()=>[{provider:"openrouter",id:"fast",api:"openai-completions",reasoning:true}],streamSimple:()=>{prompts++;return {result:async()=>({stopReason:"stop",content:[{type:"text",text:'{"r1":"shorten"}'}],usage})};}}} as unknown as ExtensionContext;
  const event={signal:new AbortController().signal,preparation:{messagesToSummarize:[{role:"user",content:[{type:"text",text:"Goal"}]},{role:"assistant",content:[{type:"toolCall",id:"a",name:"read",arguments:{path:"a"}}]},{role:"toolResult",toolCallId:"a",toolName:"read",content:[{type:"text",text:"x".repeat(3000)}],isError:false},{role:"user",content:[{type:"text",text:"Continue"}]}],turnPrefixMessages:[],firstKeptEntryId:"keep-id",tokensBefore:3000}};
  try {
    const result=await handler!(event,ctx);
    assert.equal(prompts,1);assert.equal(result.compaction.firstKeptEntryId,"keep-id");assert.equal(result.compaction.tokensBefore,3000);assert.equal(result.compaction.usage,usage);assert.equal(result.compaction.details.stats.llmResolved,1);
  } finally { globalThis.fetch=originalFetch; if(oldKey===undefined)delete process.env.TYPESAFE_API_KEY;else process.env.TYPESAFE_API_KEY=oldKey;if(oldOr===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=oldOr; }
});
