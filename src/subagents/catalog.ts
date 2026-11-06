import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface Agent { name: string; path: string; scope: "builtin" | "global" | "project" }

/** Scan configured roots in ascending precedence; project definitions replace global/builtin. */
export function scanAgents(roots: { path: string; scope: Agent["scope"] }[]): Agent[] {
  const agents = new Map<string, Agent>();
  for (const root of roots) {
    let files: string[];
    try { files = readdirSync(root.path).filter(f => f.endsWith(".md")); } catch { continue; }
    for (const file of files) {
      const path = join(root.path, file);
      try {
        const text = readFileSync(path, "utf8");
        const frontmatter = /^---\s*\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
        const name = /^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m.exec(frontmatter ?? "")?.[1]?.trim();
        if (name && /^[\w.-]+$/.test(name)) agents.set(name, { name, path, scope: root.scope });
      } catch { /* Ignore unreadable definitions. */ }
    }
  }
  return [...agents.values()].sort((a, b) => a.name.localeCompare(b.name));
}
