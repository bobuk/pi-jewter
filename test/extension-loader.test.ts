import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

test("Pi loads the real extension through its runtime loader offline", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "jewter-loader-"));
  // Override only the SDK entry point to test an installed Pi release. Use its
  // public ResourceLoader so this exercises Pi's jiti aliases, not Node imports.
  const sdk = process.env.PI_LOADER_ENTRY
    ? pathToFileURL(resolve(process.env.PI_LOADER_ENTRY)).href
    : import.meta.resolve("@earendil-works/pi-coding-agent");
  const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));
  try {
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import assert from "node:assert/strict";
      globalThis.fetch = async () => { throw new Error("Loader smoke test forbids network calls"); };
      const { DefaultResourceLoader, SettingsManager } = await import(process.env.JEWTER_TEST_SDK);
      const loader = new DefaultResourceLoader({
        cwd: process.cwd(), agentDir: process.env.PI_CODING_AGENT_DIR,
        settingsManager: SettingsManager.inMemory(),
        additionalExtensionPaths: [process.env.JEWTER_TEST_ENTRY],
        noExtensions: true, noSkills: true, noPromptTemplates: true,
        noThemes: true, noContextFiles: true,
      });
      await loader.reload();
      const result = loader.getExtensions();
      assert.deepEqual(result.errors, []);
      assert.equal(result.extensions.length, 1);
      const extension = result.extensions[0];
      assert.ok(extension.commands.has("jewter"));
      assert.ok(extension.handlers.has("session_before_compact"));
      console.log("Pi loader registered Jewter and compaction offline");
    `], {
      cwd: sandbox,
      env: { ...process.env, PI_CODING_AGENT_DIR: sandbox, JEWTER_TEST_SDK: sdk, JEWTER_TEST_ENTRY: entry },
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
    assert.match(child.stdout, /Pi loader registered Jewter and compaction offline/);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
