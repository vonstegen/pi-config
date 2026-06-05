/**
 * pi-hermes-bridge.ts
 * 
 * Bridges pi with Hermes Agent (hermes-agent.org / Nous Research).
 * 
 * Features:
 * - `hermes_subagent` tool: spawns a Hermes sub-agent for a task, returns results
 * - `hermes_memory` tool: injects Hermes's persistent memory as context
 * - `hermes_skill` tool: call a Hermes skill directly from pi
 * - `/hermes` commands: control the Hermes Agent installation
 * - Auto-reads Hermes memory on session start to inject project context
 * 
 * Prerequisites:
 * - Hermes Agent installed: https://hermes-agent.org/
 * - hermes command available in PATH
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { exec } from "child_process";
import { promisify } from "util";
import { readFile, readdir, stat } from "fs/promises";
import { join, resolve } from "path";

const execAsync = promisify(exec);

// -------------------------------------------------------------------
// Config
// -------------------------------------------------------------------

const HERMES_DIR = resolve(process.env.HERMES_DIR ?? process.env.HOME!, ".hermes");
const HERMES_SKILLS_DIR = join(HERMES_DIR, "skills");
const HERMES_MEMORY_DIR = join(HERMES_DIR, "memory");
const HERMES_MEMORY_INDEX = join(HERMES_DIR, "memory", "index.json");

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

async function hermesInstalled(): Promise<boolean> {
  try {
    await execAsync("which hermes", { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function hermesRun(args: string, timeout = 60): Promise<string> {
  const { stdout, stderr } = await execAsync(`hermes ${args}`, {
    timeout: timeout * 1000,
    encoding: "utf-8",
    env: { ...process.env, TERM: "dumb" },
  });
  if (stderr) console.warn("[hermes-stderr]", stderr);
  return stdout;
}

async function readHermesMemory(): Promise<string> {
  try {
    const files = await readdir(HERMES_MEMORY_DIR, { withFileTypes: true });
    const entries = await Promise.all(
      files
        .filter(f => f.isFile() && f.name.endsWith(".md"))
        .slice(0, 20)
        .map(async f => {
          const content = await readFile(join(HERMES_MEMORY_DIR, f.name), "utf-8");
          return `## ${f.name}\n${content}`;
        })
    );
    return entries.length > 0
      ? `\n\n--- Hermes Agent Memory ---\n${entries.join("\n\n")}\n--- End Hermes Memory ---\n`
      : "";
  } catch {
    return "";
  }
}

async function readHermesSkills(): Promise<Array<{ name: string; path: string }>> {
  try {
    const files = await readdir(HERMES_SKILLS_DIR, { withFileTypes: true });
    return files
      .filter(f => f.isDirectory())
      .map(f => ({ name: f.name, path: join(HERMES_SKILLS_DIR, f.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

// -------------------------------------------------------------------
// Extension
// -------------------------------------------------------------------
// Extension
// -------------------------------------------------------------------

export default async function (pi: ExtensionAPI) {
  const installed = await hermesInstalled();

  // -------------------------------------------------------------------
  // Tool: hermes_subagent
  // Spawns a Hermes sub-agent to handle a task independently.
  // -------------------------------------------------------------------

  pi.registerTool({
    name: "hermes_subagent",
    label: "Hermes Sub-Agent",
    description:
      "Spawn a Hermes Agent sub-agent to handle a complex multi-step task (web research, automation, etc.). " +
      "The task runs in an isolated context and results are returned. " +
      "Use this when a task would benefit from Hermes's persistent memory and skill system.",
    promptSnippet: "Web research, multi-step automation, persistent-memory tasks",
    parameters: Type.Object({
      task: Type.String({
        description:
          "The task description to give the Hermes sub-agent",
      }),
      timeout: Type.Optional(
        Type.Number({ description: "Max seconds to wait (default 120)", default: 120 }),
      ),
      model: Type.Optional(
        Type.String({ description: "Model to use (default: auto)" }),
      ),
    }),
    async execute(toolCallId, params, signal, onUpdate) {
      onUpdate?.({ content: [{ type: "text", text: "Spawning Hermes sub-agent..." }] });

      if (!installed) {
        return {
          content: [
            {
              type: "text",
              text: "Hermes Agent is not installed. Install with:\n  curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash",
            },
          ],
          details: { error: "hermes-not-installed" },
        };
      }

      try {
        const timeout = params.timeout ?? 120;
        const modelFlag = params.model ? `--model ${params.model}` : "";

        onUpdate?.({ content: [{ type: "text", text: `Running (${timeout}s timeout)...` }] });

        const output = await execAsync(
          `hermes run --non-interactive ${modelFlag} "${params.task.replace(/"/g, '\\"')}"`,
          { timeout: timeout * 1000, encoding: "utf-8", env: { ...process.env, TERM: "dumb" } },
        );

        return {
          content: [
            {
              type: "text",
              text: `## Hermes Sub-Agent Result\n\n${output.stdout || output.stderr || "(no output)"}`,
            },
          ],
          details: { exitCode: 0 },
        };
      } catch (err: unknown) {
        const error = err as { killed?: boolean; code?: number; stderr?: string };
        if (error.killed) {
          return {
            content: [{ type: "text", text: "Hermes sub-agent timed out." }],
            details: { error: "timeout", code: "ETIMEDOUT" },
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `Hermes sub-agent failed:\n${error.stderr || String(err)}`,
            },
          ],
          details: { error: "execution-failed", code: error.code },
        };
      }
    },
  });

  // -------------------------------------------------------------------
  // Tool: hermes_memory
  // Reads Hermes Agent's persistent memory and returns it as context.
  // -------------------------------------------------------------------

  pi.registerTool({
    name: "hermes_memory",
    label: "Hermes Memory",
    description:
      "Read Hermes Agent's persistent memory store (project knowledge, preferences, past tasks). " +
      "Returns structured memory entries that can be used as context for the current task.",
    promptSnippet: "Retrieve long-term project memory and context",
    parameters: Type.Object({
      query: Type.Optional(
        Type.String({ description: "Optional search query to filter memories" }),
      ),
      max_entries: Type.Optional(
        Type.Number({ description: "Max memory entries to return (default 10)", default: 10 }),
      ),
    }),
    async execute(toolCallId, params, signal, onUpdate) {
      if (!installed) {
        return {
          content: [{ type: "text", text: "Hermes Agent not installed." }],
          details: { error: "not-installed" },
        };
      }

      const memory = await readHermesMemory();
      if (!memory) {
        return {
          content: [
            {
              type: "text",
              text: "No Hermes memory found. Hermes Agent may not have been configured yet.",
            },
          ],
          details: { entries: 0 },
        };
      }

      const lines = memory.split("\n");
      const max = params.max_entries ?? 10;
      const filtered = params.query
        ? lines.filter(l => l.toLowerCase().includes(params.query!.toLowerCase()))
        : lines;
      const trimmed = filtered.slice(0, 200).join("\n");

      return {
        content: [
          {
            type: "text",
            text: `## Hermes Agent Memory\n\n${trimmed}\n\n(${filtered.length} matching entries, showing first ${max * 10})`,
          },
        ],
        details: { entries: filtered.length },
      };
    },
  });

  // -------------------------------------------------------------------
  // Tool: hermes_skill
  // Execute a Hermes skill (SKILL.md) from pi.
  // -------------------------------------------------------------------

  pi.registerTool({
    name: "hermes_skill",
    label: "Hermes Skill",
    description: "List or invoke a Hermes Agent skill by name.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("list"), Type.Literal("run")] as const, {
        description: "Action: list available skills or run a specific one",
      }),
      name: Type.Optional(
        Type.String({ description: "Skill name to run (required if action=run)" }),
      ),
      input: Type.Optional(
        Type.String({ description: "Input to pass to the skill" }),
      ),
    }),
    async execute(toolCallId, params, signal, onUpdate) {
      if (params.action === "list") {
        const skills = await readHermesSkills();
        if (skills.length === 0) {
          return {
            content: [{ type: "text", text: "No Hermes skills found." }],
            details: { count: 0 },
          };
        }
        const list = skills.map(s => `- **${s.name}**`).join("\n");
        return {
          content: [
            {
              type: "text",
              text: `## Hermes Agent Skills\n\n${list}\n\nUse \`hermes_skill\` with action="run" and name=<skill> to invoke one.`,
            },
          ],
          details: { count: skills.length, skills: skills.map(s => s.name) },
        };
      }

      if (!params.name) {
        return {
          content: [{ type: "text", text: "action=run requires a name parameter." }],
          details: { error: "missing-name" },
        };
      }

      try {
        const output = await hermesRun(`skill ${params.name} ${params.input ?? ""}`);
        return {
          content: [
            {
              type: "text",
              text: `## Hermes Skill: ${params.name}\n\n${output}`,
            },
          ],
          details: { skill: params.name },
        };
      } catch {
        return {
          content: [{ type: "text", text: `Skill "${params.name}" not found or failed.` }],
          details: { error: "skill-not-found" },
        };
      }
    },
  });

  // -------------------------------------------------------------------
  // Tool: hermes_status
  // Check Hermes Agent installation status.
  // -------------------------------------------------------------------

  pi.registerTool({
    name: "hermes_status",
    label: "Hermes Status",
    description: "Check if Hermes Agent is installed, its version, and memory stats.",
    parameters: Type.Object({}),
    async execute(toolCallId, params, signal, onUpdate) {
      if (!installed) {
        return {
          content: [
            {
              type: "text",
              text: "Hermes Agent is not installed.\n\nInstall: curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash",
            },
          ],
          details: { installed: false },
        };
      }

      try {
        const version = await hermesRun("--version");
        let memoryCount = 0;
        try {
          const files = await readdir(HERMES_MEMORY_DIR);
          memoryCount = files.filter(f => f.endsWith(".md")).length;
        } catch {}

        const skills = await readHermesSkills();

        return {
          content: [
            {
              type: "text",
              text:
                `Hermes Agent: ✅ Installed\n` +
                `Version: ${version.trim()}\n` +
                `Memory entries: ${memoryCount}\n` +
                `Skills: ${skills.length}`,
            },
          ],
          details: { installed: true, version: version.trim(), memoryCount, skills: skills.map(s => s.name) },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Hermes check failed: ${err}` }],
          details: { installed: true, error: String(err) },
        };
      }
    },
  });

  // -------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------

  pi.registerCommand("hermes", {
    description: "Control Hermes Agent — status, install, run, gateway",
    getArgumentCompletions: (prefix) => {
      const subs = ["status", "install", "update", "run", "gateway", "memory", "skills"];
      return subs.map(s => ({ value: s })).filter(s => s.value.startsWith(prefix));
    },
    handler: async (args, ctx) => {
      const sub = args.trim().split(/\s+/)[0];

      if (!sub || sub === "status") {
        if (!installed) {
          ctx.ui.notify("Hermes Agent not installed", "warning");
          return;
        }
        try {
          const version = await hermesRun("--version");
          ctx.ui.notify(`Hermes: ${version.trim()}`, "info");
        } catch {
          ctx.ui.notify("Hermes check failed", "error");
        }
        return;
      }

      if (sub === "install") {
        ctx.ui.notify("Open https://hermes-agent.org for install instructions", "info");
        return;
      }

      if (sub === "run") {
        const task = args.trim().slice(3).trim();
        if (!task) {
          ctx.ui.notify("Usage: /hermes run <task>", "warning");
          return;
        }
        ctx.ui.notify("Spawning Hermes sub-agent...", "info");
        pi.sendUserMessage(
          `Spawn a Hermes sub-agent for: ${task}`,
          { deliverAs: ctx.isIdle() ? undefined : "steer" },
        );
        return;
      }

      ctx.ui.notify(`Unknown subcommand: ${sub}`, "warning");
    },
  });

  // -------------------------------------------------------------------
  // Session start: inject Hermes memory as context
  // -------------------------------------------------------------------

  pi.on("before_agent_start", async (event, ctx) => {
    if (!installed) return;

    const memory = await readHermesMemory();
    if (!memory) return;

    return {
      message: {
        customType: "hermes-memory",
        content: memory,
        display: false, // hidden from TUI
      },
    };
  });

  // -------------------------------------------------------------------
  // Startup: notify if Hermes is available
  // -------------------------------------------------------------------

  if (installed) {
    pi.on("session_start", async (_event, ctx) => {
      ctx.ui.notify("Hermes Agent: ✅ Connected", "info");
    });
  }
}
