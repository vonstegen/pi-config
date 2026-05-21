/**
 * wiki-janitor extension for pi
 *
 * - Spawns the wiki janitor daemon on startup
 * - Exports session summaries to ~/wiki/sources/sessions/ on shutdown
 * - Registers a wiki_save tool so pi's LLM can drop content into the wiki
 */

import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ChildProcess } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const WIKI_ROOT = join(homedir(), "wiki");
const JANITOR_PATH = join(homedir(), ".local", "bin", "wiki-janitor", "janitor.js");
const AM_BRIDGE_PATH = join(homedir(), ".local", "bin", "wiki-janitor", "agentmemory-bridge.js");
const AGENTMEMORY_URL = process.env.AGENTMEMORY_URL || "http://localhost:3111";
const SESSIONS_DIR = join(WIKI_ROOT, "sources", "sessions");

let janitorProcess: ChildProcess | null = null;
let agentMemoryBridgeProcess: ChildProcess | null = null;
let agentMemoryServerProcess: ChildProcess | null = null;

function isProcessRunning(proc: ChildProcess | null) {
  if (!proc || proc.killed || !proc.pid) return false;
  try {
    process.kill(proc.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function startDetachedProcess(
  command: string,
  args: string[],
  env: Record<string, string | undefined>,
  onExit: () => void,
) {
  const proc = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, ...env },
  });

  proc.on("error", (err) => {
    console.error(`[wiki] Process error: ${err.message}`);
  });

  proc.on("exit", () => {
    onExit();
  });

  proc.unref();
  return proc;
}

function startJanitor(ctx: any) {
  if (isProcessRunning(janitorProcess)) {
    ctx.ui.notify("Wiki janitor already running", "info");
    return;
  }

  try {
    janitorProcess = startDetachedProcess(
      "node",
      [JANITOR_PATH],
      {
        WIKI_ROOT,
        JANITOR_MODEL: process.env.JANITOR_MODEL || "hermes3:8b",
      },
      () => {
        janitorProcess = null;
      },
    );

    ctx.ui.notify("Wiki janitor started (hermes3:8b)", "info");
  } catch (e: any) {
    ctx.ui.notify(`Failed to start wiki janitor: ${e.message}`, "error");
  }
}

async function isAgentMemoryHealthy() {
  try {
    const res = await fetch(`${AGENTMEMORY_URL.replace(/\/+$/, "")}/agentmemory/health`, {
      headers: process.env.AGENTMEMORY_SECRET
        ? { Authorization: `Bearer ${process.env.AGENTMEMORY_SECRET}` }
        : undefined,
    });
    if (!res.ok) return false;
    const data: any = await res.json();
    return data?.status === "healthy" || data?.health?.status === "healthy";
  } catch {
    return false;
  }
}

async function startAgentMemoryServer(ctx: any) {
  if (await isAgentMemoryHealthy()) {
    ctx.ui.notify("AgentMemory server reachable", "info");
    return;
  }

  if (isProcessRunning(agentMemoryServerProcess)) {
    ctx.ui.notify("AgentMemory server process already running (waiting for health)", "info");
    return;
  }

  try {
    agentMemoryServerProcess = startDetachedProcess(
      "npx",
      ["-y", "@agentmemory/agentmemory"],
      {
        AGENTMEMORY_URL,
      },
      () => {
        agentMemoryServerProcess = null;
      },
    );

    ctx.ui.notify("Started AgentMemory server", "info");
  } catch (e: any) {
    ctx.ui.notify(`Failed to start AgentMemory server: ${e.message}`, "error");
  }
}

function startAgentMemoryBridge(ctx: any) {
  if (isProcessRunning(agentMemoryBridgeProcess)) {
    ctx.ui.notify("AgentMemory→Wiki bridge already running", "info");
    return;
  }

  try {
    agentMemoryBridgeProcess = startDetachedProcess(
      "node",
      [AM_BRIDGE_PATH],
      {
        WIKI_ROOT,
        AGENTMEMORY_URL,
      },
      () => {
        agentMemoryBridgeProcess = null;
      },
    );

    ctx.ui.notify("AgentMemory→Wiki bridge started", "info");
  } catch (e: any) {
    ctx.ui.notify(`Failed to start AgentMemory→Wiki bridge: ${e.message}`, "error");
  }
}

async function exportSessionToWiki(sessionManager, ctx) {
  try {
    await mkdir(SESSIONS_DIR, { recursive: true });

    const entries = sessionManager.getEntries?.() || [];
    const filename = `session-${Date.now()}.md`;

    // Build a readable summary
    let content = `# Session Export\n\n`;
    content += `**Date:** ${new Date().toISOString().split("T")[0]}\n`;
    content += `**Agent:** pi\n`;
    content += `**Entries:** ${entries.length}\n\n`;

    content += `## Conversation\n\n`;

    for (const entry of entries) {
      if (entry.role === "user" && entry.content?.[0]?.text) {
        content += `### User\n${entry.content[0].text.slice(0, 500)}\n\n`;
      } else if (entry.role === "assistant" && entry.content?.[0]?.text) {
        const text = entry.content[0].text;
        // Only include substantial assistant responses
        if (text.length > 50) {
          content += `### Assistant\n${text.slice(0, 500)}\n\n`;
        }
      } else if (entry.type === "compaction") {
        content += `### Context Summary\n${entry.summary?.slice(0, 300) || ""}\n\n`;
      }
    }

    // Write the session export
    const exportPath = join(SESSIONS_DIR, filename);
    await writeFile(exportPath, content, "utf-8");

    ctx.ui.notify(`Session exported to wiki: ${filename}`, "info");
  } catch (e) {
    // Silently fail — don't block shutdown on wiki export issues
  }
}

export default function (pi: ExtensionAPI) {
  // ── Start AgentMemory server + bridge + janitor on pi startup ───────────
  pi.on("session_start", async (event, ctx) => {
    if (event.reason === "startup") {
      await startAgentMemoryServer(ctx);
      startAgentMemoryBridge(ctx);
      startJanitor(ctx);
    }
  });

  // ── Export session to wiki on shutdown ───────────────────────────────────
  pi.on("session_shutdown", async (event, ctx) => {
    if (event.reason === "quit" || event.reason === "new") {
      await exportSessionToWiki(ctx.sessionManager, ctx);
    }
  });

  // ── Register wiki_save tool ──────────────────────────────────────────────
  pi.registerTool({
    name: "wiki_save",
    label: "Save to Wiki",
    description:
      "Save a piece of content to the wiki's sources directory. The wiki janitor (background daemon with hermes3:8b) will process it, integrate it into the knowledge base, update cross-references, and maintain the index. Use this to preserve important discoveries, decisions, research findings, or anything worth remembering across sessions.",
    promptSnippet:
      "Persist content to wiki: puts it in ~/wiki/sources/ for the janitor to ingest",
    promptGuidelines: [
      "Use wiki_save to persist important findings, decisions, or research to the knowledge wiki. The janitor will integrate it into ~/wiki/ automatically.",
    ],
    parameters: Type.Object({
      title: Type.String({ description: "Title for this piece of content" }),
      content: Type.String({ description: "The content to save (markdown formatted). Include key insights, entities mentioned, and any relevant context." }),
      category: Type.String({
        description: "Category: 'discovery', 'decision', 'research', 'session-note', or 'source'",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        await mkdir(SESSIONS_DIR, { recursive: true });
        const slug = params.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        const filename = `${new Date().toISOString().split("T")[0]}-${params.category}-${slug}.md`;
        const fullContent = `# ${params.title}\n\n**Category:** ${params.category}\n**Saved:** ${new Date().toISOString()}\n\n${params.content}\n`;

        const dest = join(SESSIONS_DIR, filename);
        await writeFile(dest, fullContent, "utf-8");

        return {
          content: [
            {
              type: "text",
              text: `Saved to wiki: ${filename}\nThe wiki janitor (hermes3:8b) will process this and integrate it into ~/wiki/.`,
            },
          ],
          details: { file: dest },
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Failed to save to wiki: ${e.message}` }],
          details: {},
          isError: true,
        };
      }
    },
  });

  // ── Register /wiki-lint command ──────────────────────────────────────────
  pi.registerCommand("wiki-lint", {
    description: "Ask the wiki janitor to run a consistency check on the knowledge base",
    handler: async (_args, ctx) => {
      // Drop a lint-request file that the janitor will pick up
      const lintRequest = `# Lint Request\n\n**Requested:** ${new Date().toISOString()}\n\nRun a full consistency check on the wiki following the schema's lint workflow:\n- Check for contradictions between pages\n- Find orphan pages with no inbound links\n- Identify missing cross-references\n- Flag stale claims\n- Suggest new questions or sources to investigate\n- Report findings in log.md\n`;
      const dest = join(SESSIONS_DIR, `lint-request-${Date.now()}.md`);
      await writeFile(dest, lintRequest, "utf-8");

      ctx.ui.notify("Lint request dropped. The janitor will process it.", "info");
    },
  });

  // ── Register /wiki-status command ────────────────────────────────────────
  pi.registerCommand("wiki-status", {
    description: "Show whether AgentMemory server, bridge, and wiki janitor are running",
    handler: async (_args, ctx) => {
      const memoryServerOk = await isAgentMemoryHealthy();
      const janitorOk = isProcessRunning(janitorProcess);
      const bridgeOk = isProcessRunning(agentMemoryBridgeProcess);

      const parts = [
        `AgentMemory server: ${memoryServerOk ? "healthy" : "unreachable"}`,
        `AgentMemory→Wiki bridge: ${bridgeOk ? `running (PID ${agentMemoryBridgeProcess?.pid})` : "not running"}`,
        `Wiki janitor: ${janitorOk ? `running (PID ${janitorProcess?.pid}, model hermes3:8b)` : "not running"}`,
      ];

      ctx.ui.notify(parts.join(" | "), memoryServerOk && bridgeOk && janitorOk ? "info" : "warn");
    },
  });
}
