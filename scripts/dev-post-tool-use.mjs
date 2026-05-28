/**
 * Dev-only PostToolUse hook for working ON brooks-lint (not shipped to plugin users).
 *
 * Reads the Claude Code PostToolUse JSON payload from stdin, and when an edit
 * touches a drift-prone file:
 *   - runs `npm run validate` (manifest/badge/changelog/book-count/skill-step gate)
 *   - mirrors skills/ into the local-test install IF that dir already exists
 *
 * Wired up from .claude/settings.local.json (maintainer-local, untracked):
 *   PostToolUse → command: node "$CLAUDE_PROJECT_DIR/scripts/dev-post-tool-use.mjs"
 *
 * Exit codes: 0 = clean/no-op; 2 = validate failed (stderr is fed back to Claude).
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ROOT_MANIFESTS = new Set([
  "package.json",
  "README.md",
  "CHANGELOG.md",
  "AGENTS.md",
  "GEMINI.md",
  "gemini-extension.json",
  ".claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
  ".codex-plugin/plugin.json",
]);

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("");
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => (buf += d));
    process.stdin.on("end", () => resolve(buf));
  });
}

function relPath(filePath) {
  if (!filePath) return null;
  const rel = path.relative(repoRoot, path.resolve(repoRoot, filePath));
  return rel.startsWith("..") ? null : rel;
}

const raw = await readStdin();
let rel = null;
try {
  rel = relPath(JSON.parse(raw)?.tool_input?.file_path);
} catch {
  process.exit(0); // not a JSON payload we understand — stay out of the way
}
if (!rel) process.exit(0);

const isSkillEdit = rel.startsWith("skills/");
const needsValidate =
  isSkillEdit || ROOT_MANIFESTS.has(rel) || rel.endsWith("source-coverage.md");

if (isSkillEdit) {
  const localInstall = path.join(homedir(), ".claude", "skills", "brooks-lint");
  if (existsSync(localInstall)) {
    cpSync(path.join(repoRoot, "skills"), localInstall, { recursive: true });
  }
}

if (needsValidate) {
  try {
    execFileSync("npm", ["run", "validate"], { cwd: repoRoot, stdio: "pipe" });
  } catch (err) {
    const out = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim();
    process.stderr.write(`brooks-lint validate failed after editing ${rel}:\n${out}\n`);
    process.exit(2); // surfaces to Claude so it can fix the drift it just introduced
  }
}

process.exit(0);
