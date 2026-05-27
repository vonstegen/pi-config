/**
 * VibeLLM Extension for Pi
 *
 * Bridges pi (coding agent harness) with VibeLLM (self-evolving AI training system).
 *
 * Registered tools:
 *   vibellm_status      — Check VibeLLM training environment and adapter status
 *   vibellm_train        — Trigger QLoRA training on a JSONL data file
 *   vibellm_smoke_test   — Quick training smoke test (5 examples, 1 epoch)
 *   vibellm_pool_status  — Show synthetic training pool accumulation
 *   vibellm_feed         — Add a training pair to the synthetic pool
 *   vibellm_evolve       — Trigger a VibeLLM evolution cycle
 *   vibellm_history      — Show training history (all adapters)
 *
 * Commands:
 *   /vibellm             — Interactive VibeLLM management panel
 *
 * Usage:
 *   Copy to ~/.pi/agent/extensions/vibellm.ts
 *   Or: ~/.pi/agent/extensions/vibellm/index.ts
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execSync } from "node:child_process";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";

const VIBELLM_ROOT = `${process.env.HOME}/vibellm`;
const ECHELON_URL = "http://localhost:5000";
const PYTHON = "python3";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Run a Python command in the vibellm project and return { stdout, stderr, ok } */
function runPython(cmd: string, timeout = 60_000): { stdout: string; stderr: string; ok: boolean } {
  try {
    const stdout = execSync(
      `cd ${VIBELLM_ROOT} && ${PYTHON} ${cmd}`,
      { timeout, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 }
    );
    return { stdout: stdout.slice(-8000), stderr: "", ok: true };
  } catch (e: any) {
    return {
      stdout: e.stdout?.slice(-4000) || "",
      stderr: e.stderr?.slice(-4000) || e.message || "Unknown error",
      ok: false,
    };
  }
}

/** Try HTTP call to Echelon VibeLLM API, fall back to Python CLI */
async function tryEchelon(path: string, method = "GET", body?: any) {
  try {
    const opts: any = { method, signal: AbortSignal.timeout(5000) };
    if (body) {
      opts.headers = { "Content-Type": "application/json" };
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`${ECHELON_URL}${path}`, opts);
    if (res.ok) {
      const data = await res.json();
      return { ok: true, data, source: "echelon-api" as const };
    }
    return { ok: false, error: `HTTP ${res.status}: ${await res.text().catch(() => "")}` };
  } catch {
    return { ok: false, error: "Echelon not reachable" };
  }
}

/** Clean ANSI escapes from string for LLM readability */
function stripAnsi(s: string): string {
  return s.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
}

// ── Extension ────────────────────────────────────────────────────────────────

export default function vibellmExtension(pi: ExtensionAPI) {
  // ── vibellm_status ──
  pi.registerTool({
    name: "vibellm_status",
    label: "VibeLLM Status",
    description:
      "Check the VibeLLM training system status: hardware, models, adapters, synthetic pool size, and environment readiness.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const { stdout, stderr, ok } = runPython("-m training.cli check", 30_000);
      const text = ok ? stripAnsi(stdout) : `Error: ${stderr}`;
      return { content: [{ type: "text", text }], details: { ok, source: "vibellm-cli" } };
    },
  });

  // ── vibellm_train ──
  pi.registerTool({
    name: "vibellm_train",
    label: "VibeLLM Train",
    description:
      "Run QLoRA fine-tuning on a JSONL training data file. Each line must be {\"prompt\": \"...\", \"response\": \"...\"}. Uses 4-bit QLoRA with Unsloth on Qwen3-8B (8GB VRAM).",
    parameters: Type.Object({
      data: Type.String({ description: "Path to JSONL training data file" }),
      model: Type.Optional(Type.String({ description: "Model: qwen3-8b (default), qwen2.5-7b, llama3.1-8b, phi3-mini, gemma2-9b" })),
      epochs: Type.Optional(Type.Number({ description: "Training epochs (1-3, default 3)" })),
      learning_rate: Type.Optional(Type.Number({ description: "Learning rate (default 2e-4)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const model = params.model || "qwen3-8b";
      const epochs = params.epochs || 3;
      const lr = params.learning_rate || 0.0002;
      const data = params.data;

      if (!existsSync(data)) {
        return {
          content: [{ type: "text", text: `✗ Data file not found: ${data}` }],
          details: { ok: false },
        };
      }

      ctx.ui.notify(`Training started on ${data} (${model}, ${epochs} epochs). This may take several minutes...`, "info");

      const { stdout, stderr, ok } = runPython(
        `-m training.cli train --data "${data}" --model ${model} --epochs ${epochs} --lr ${lr}`,
        900_000 // 15 min timeout
      );

      const text = ok ? stripAnsi(stdout) : `✗ Training error:\n${stderr.slice(-3000)}`;
      return { content: [{ type: "text", text }], details: { ok, source: "vibellm-cli" } };
    },
  });

  // ── vibellm_smoke_test ──
  pi.registerTool({
    name: "vibellm_smoke_test",
    label: "VibeLLM Smoke Test",
    description:
      "Run a quick training smoke test (5 synthetic examples, 1 epoch). Verifies the entire pipeline: model loading → LoRA → training → adapter save. Takes ~10–15 seconds.",
    parameters: Type.Object({
      model: Type.Optional(Type.String({ description: "Model to test (default: qwen3-8b)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const model = params.model || "qwen3-8b";
      ctx.ui.notify("Running VibeLLM smoke test...", "info");

      const { stdout, stderr, ok } = runPython(
        `-m training.cli smoke-test --model ${model}`,
        120_000
      );

      const text = ok ? stripAnsi(stdout) : `✗ Smoke test failed:\n${stderr.slice(-3000)}`;
      return { content: [{ type: "text", text }], details: { ok, source: "vibellm-cli" } };
    },
  });

  // ── vibellm_pool_status ──
  pi.registerTool({
    name: "vibellm_pool_status",
    label: "VibeLLM Pool Status",
    description:
      "Check the synthetic training pool: how many examples have been accumulated, which dimensions are targeted, and how close to the training threshold (50).",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const { stdout, ok } = runPython("-m training.cli pool-status", 15_000);
      const text = ok ? stripAnsi(stdout) : `Error checking pool: ${stdout}`;
      return { content: [{ type: "text", text }], details: { ok } };
    },
  });

  // ── vibellm_feed ──
  pi.registerTool({
    name: "vibellm_feed",
    label: "VibeLLM Feed",
    description:
      "Add a prompt/response training pair to VibeLLM's synthetic pool. The pool accumulates examples, and when it reaches 50, training automatically triggers. Use this after you've observed a good interaction that demonstrates a skill worth learning.",
    parameters: Type.Object({
      prompt: Type.String({ description: "The user's prompt/question" }),
      response: Type.String({ description: "The model's response to learn from" }),
      dimension: Type.Optional(Type.String({
        description: "Dimension targeted: depth, usefulness, style_alignment, or novelty"
      })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const script = `
import json, sys
sys.path.insert(0, "${VIBELLM_ROOT}")
from training.data_pipeline import save_synthetic_pair, pool_size
prompt = """${params.prompt.replace(/"/g, '\\"')}"""
response = """${params.response.replace(/"/g, '\\"')}"""
${params.dimension ? `save_synthetic_pair(prompt=prompt, response=response, metadata={"dimension_targeted": "${params.dimension}"})` : 'save_synthetic_pair(prompt=prompt, response=response)'}
size = pool_size()
print(f"\\u2713 Training pair added. Pool now has {size} examples (threshold: 50)")
`;

      const tmpFile = "/tmp/vibellm_feed.py";
      writeFileSync(tmpFile, script);
      const result = runPython(tmpFile, 10_000);

      const text = result.ok ? result.stdout : `Error: ${result.stderr || result.stdout}`;
      try { unlinkSync(tmpFile); } catch {}
      return {
        content: [{ type: "text", text: stripAnsi(text) }],
        details: { ok: result.ok, source: "vibellm-cli" },
      };
    },
  });

  // ── vibellm_evolve ──
  pi.registerTool({
    name: "vibellm_evolve",
    label: "VibeLLM Evolve",
    description:
      "Trigger a VibeLLM evolution cycle: Plan → Act → Critique → Synthesize → (train when pool ≥ 50) → Evaluate → Promote/Rollback. Requires the Echelon backend to be running on port 5000.",
    parameters: Type.Object({
      prompt: Type.Optional(Type.String({
        description: "Task for the evolution cycle (default: system self-reflection)"
      })),
      thread_id: Type.Optional(Type.String({
        description: "Thread ID for resuming a previously interrupted cycle"
      })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      // Try Echelon API first
      const echelon = await tryEchelon(
        "/vibellm/evolve",
        "POST",
        { prompt: params.prompt || "Reflect on recent interactions and improve." }
      );

      if (echelon.ok && echelon.source === "echelon-api") {
        const data = echelon.data as any;
        return {
          content: [{
            type: "text",
            text: `✓ Evolution cycle started.\nThread ID: ${data.thread_id}\nStatus: ${data.status}\n\nTo approve/reject, use vibellm_approve or vibellm_reject with this thread_id.`,
          }],
          details: { ok: true, thread_id: data.thread_id, source: "echelon-api" },
        };
      }

      // Fallback: run evolution directly
      const { stdout, stderr, ok } = runPython(
        `-c "
import sys; sys.path.insert(0, '${VIBELLM_ROOT}')
from loop.reflection_loop import run_evolution_cycle
result = run_evolution_cycle('${(params.prompt || 'Reflect on recent interactions and improve.').replace(/'/g, "\\'")}')
print(f'Stage: {result[\"stage\"]}')
print(f'LoRA version: {result.get(\"lora_version\", \"none\")}')
print(f'Approved: {result.get(\"approved\", \"N/A\")}')
"`,
        300_000
      );

      if (ok) {
        return {
          content: [{ type: "text", text: `✓ Evolution cycle completed.\n\n${stripAnsi(stdout.slice(-3000))}` }],
          details: { ok: true, source: "vibellm-direct" },
        };
      }

      return {
        content: [{ type: "text", text: `⚠ Echelon not reachable and direct run had issues:\n\n${stderr.slice(-2000)}\n\nStart Echelon with: cd ~/echelon && ./start.sh` }],
        details: { ok: false },
      };
    },
  });

  // ── vibellm_history ──
  pi.registerTool({
    name: "vibellm_history",
    label: "VibeLLM History",
    description: "Show VibeLLM training history: all adapters with version, model, loss, and promotion status.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const { stdout, ok } = runPython("-m training.cli history", 15_000);
      const text = ok ? stripAnsi(stdout) : `Error: ${stdout}`;
      return { content: [{ type: "text", text }], details: { ok } };
    },
  });

  // ── /vibellm command ──
  pi.registerCommand("vibellm", {
    description: "Interactive VibeLLM management panel",
    handler: async (_args, ctx) => {
      // Show a quick status summary
      const { stdout: statusOut } = runPython("-m training.cli check 2>&1 | head -25", 20_000);
      const { stdout: poolOut } = runPython("-m training.cli pool-status 2>&1", 10_000);

      const summary = [
        "═══ VibeLLM Management ═══",
        "",
        "Available pi tools:",
        "  vibellm_status      — Full environment check",
        "  vibellm_train        — Train on JSONL data",
        "  vibellm_smoke_test   — Quick pipeline test (~10s)",
        "  vibellm_pool_status  — Synthetic pool stats",
        "  vibellm_feed         — Add training pair to pool",
        "  vibellm_evolve       — Trigger evolution cycle",
        "  vibellm_history      — Training run history",
        "",
        "--- Status Snapshot ---",
        stripAnsi(statusOut).split("\n").filter(l => l.includes("✓") || l.includes("✗") || l.includes("GB")).join("\n"),
        "",
        stripAnsi(poolOut),
        "",
        "Training triggers when pool reaches 50 examples.",
        "Use vibellm_feed to contribute training data.",
      ].join("\n");

      ctx.ui.notify(summary, "info");
    },
  });

  // ── Session start notification ──
  pi.on("session_start", async (_event, ctx) => {
    const { ok } = runPython("-c \"from training.data_pipeline import pool_size; print(pool_size())\"", 5_000);
    // Silent — just verify vibellm is reachable
  });
}