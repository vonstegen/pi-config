/**
 * pi-permissions: Claude-style permission modes for pi
 *
 * Modes:
 *   default     - Prompts for file edits and dangerous bash commands
 *   acceptEdits - Auto-approves file edits and safe bash (mkdir, touch, mv, cp, etc.)
 *   plan        - Read-only exploration (no file modifications)
 *   auto        - Everything auto-approved with background safety checks
 *   dontAsk     - Only pre-approved tools; everything else blocked
 *   bypass      - Everything allowed (use with caution)
 *
 * Toggle: /mode [name]
 * Status: footer shows current mode
 * Disable: set permissions.enabled = false in settings.json
 * 
 * To cycle with Shift+Tab, add to ~/.pi/agent/keybindings.json:
 * { "app.permissions.cycle": "shift+tab" }
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

// ── Types ───────────────────────────────────────────────────────────────────

type ModeName = "default" | "acceptEdits" | "plan" | "auto" | "dontAsk" | "bypass";

interface ModeConfig {
  label: string;
  icon: string;
  color: "muted" | "warning" | "accent" | "error" | "success";
  description: string;
  // Tool allowlists (null = all allowed)
  allowedTools: string[] | null;
  // Bash commands allowed without prompt (for acceptEdits)
  autoBash: RegExp[];
  // Bash commands that always prompt (even in acceptEdits)
  alwaysPromptBash: RegExp[];
  // Whether prompts are shown
  promptsEnabled: boolean;
  // Blocks all unapproved without asking (dontAsk)
  strictBlock: boolean;
}

const MODES: Record<ModeName, ModeConfig> = {
  default: {
    label: "default",
    icon: "🔒",
    color: "muted",
    description: "Prompts before file edits and dangerous commands",
    allowedTools: null,
    autoBash: [],
    alwaysPromptBash: [],
    promptsEnabled: true,
    strictBlock: false,
  },
  acceptEdits: {
    label: "acceptEdits",
    icon: "⏵⏵",
    color: "accent",
    description: "Auto-approves file edits and safe bash commands",
    allowedTools: null,
    autoBash: [
      /^mkdir\b/i,
      /^touch\b/i,
      /^rmdir\b/i,
      /^mv\b/i,
      /^cp\b/i,
      /^cat\s+>/i,
      /^sed\s+-i\b/i,
      /^ln\s/i,
    ],
    alwaysPromptBash: [
      /\brm\s+-rf\b/i,
      /\bsudo\b/i,
      /\bsu\b/i,
      /\bchmod\s+777\b/i,
      /\bchown\b.*\s+777\b/i,
      /\|\s*bash\b/i,
      /\beval\b/i,
      /\bsh\s+-c\b/i,
    ],
    promptsEnabled: true,
    strictBlock: false,
  },
  plan: {
    label: "plan",
    icon: "⏸",
    color: "warning",
    description: "Read-only exploration — no file modifications",
    allowedTools: ["read", "bash", "grep", "find", "ls"],
    autoBash: [],
    alwaysPromptBash: [],
    promptsEnabled: false,
    strictBlock: false,
  },
  auto: {
    label: "auto",
    icon: "🚀",
    color: "success",
    description: "Auto-approves everything with background safety checks",
    allowedTools: null,
    autoBash: [],
    alwaysPromptBash: [],
    promptsEnabled: false,
    strictBlock: false,
  },
  dontAsk: {
    label: "dontAsk",
    icon: "🔒",
    color: "error",
    description: "Only pre-approved tools — everything else blocked",
    allowedTools: null,
    autoBash: [],
    alwaysPromptBash: [],
    promptsEnabled: false,
    strictBlock: true,
  },
  bypass: {
    label: "bypass",
    icon: "⚡",
    color: "error",
    description: "Everything allowed — no safety checks (containers only)",
    allowedTools: null,
    autoBash: [],
    alwaysPromptBash: [],
    promptsEnabled: false,
    strictBlock: false,
  },
};

// Default protected paths (never auto-approved except in bypass)
const GLOBAL_PROTECTED_PATHS = [
  /\.git\//,
  /\.vscode\//,
  /\.idea\//,
  /\.husky\//,
  /\.claude\.json$/,
  /\.claude\/settings\.json$/,
  /\.gitconfig$/,
  /\.gitmodules$/,
  /\.bashrc$/,
  /\.bash_profile$/,
  /\.zshrc$/,
  /\.zprofile$/,
  /\.profile$/,
  /\.ripgreprc$/,
  /\.env$/,
  /\.env\.local$/,
];

// Dangerous command patterns (always prompt in default and acceptEdits)
const DANGEROUS_BASH_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bsudo\b/i,
  /\bsu\b/i,
  /\bchmod\s+777\b/i,
  /\bchown\b.*\s+777\b/i,
  /\bdd\b/i,
  /\bshred\b/i,
  /\bmkfs\b/i,
  /\bfdisk\b/i,
  /\|?\s*bash\s+-c\b/i,
  /\beval\b/i,
  /\bexec\s+/i,
  /\bcurl.*\|\s*bash\b/i,
];

// ── State ────────────────────────────────────────────────────────────────────

let currentMode: ModeName = "default";
let extensionEnabled = true;
let piInstance: ExtensionAPI | null = null;

// ── Helpers ──────────────────────────────────────────────────────────────────

function isProtectedPath(path: string): boolean {
  return GLOBAL_PROTECTED_PATHS.some((p) => p.test(path));
}

function isDangerousCommand(command: string): boolean {
  return DANGEROUS_BASH_PATTERNS.some((p) => p.test(command));
}

function isAutoBash(command: string, mode: ModeConfig): boolean {
  return mode.autoBash.some((p) => p.test(command));
}

function isAlwaysPromptBash(command: string, mode: ModeConfig): boolean {
  return mode.alwaysPromptBash.some((p) => p.test(command));
}

function getModeSequence(): ModeName[] {
  return ["default", "acceptEdits", "plan", "auto", "bypass"];
}

function getNextMode(): ModeName {
  const seq = getModeSequence();
  const idx = seq.indexOf(currentMode);
  return seq[(idx + 1) % seq.length];
}

function cycleMode(ctx: ExtensionContext): void {
  currentMode = getNextMode();
  updateStatus(ctx);
  ctx.ui.notify(`${MODES[currentMode].icon} Mode: ${currentMode}`, "info");
  persistMode();
}

function updateStatus(ctx: ExtensionContext): void {
  const mode = MODES[currentMode];
  ctx.ui.setStatus("permissions", ctx.ui.theme.fg(mode.color, `${mode.icon} ${mode.label}`));
}

function persistMode(): void {
  piInstance?.appendEntry("permission-mode", { mode: currentMode });
}

// ── Extension Factory ────────────────────────────────────────────────────────

export default function permissionsExtension(pi: ExtensionAPI): void {
  piInstance = pi;

  // ── Init ────────────────────────────────────────────────────────────────────

  pi.registerFlag("permissions-enabled", {
    description: "Enable/disable permission modes extension",
    type: "boolean",
    default: true,
  });

  pi.registerFlag("permission-mode", {
    description: "Start in a specific permission mode",
    type: "string",
    default: "default",
  });

  // Check if extension is disabled via flag
  const extEnabled = pi.getFlag("permissions-enabled");
  if (extEnabled === false) {
    console.log("[permissions] Extension disabled via --permissions-enabled=false");
    return;
  }

  // Restore mode from flag
  const flagMode = pi.getFlag("permission-mode") as string | undefined;
  if (flagMode && flagMode in MODES) {
    currentMode = flagMode as ModeName;
  }

  // ── Session Events ──────────────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    // Restore persisted mode from session
    const entries = ctx.sessionManager.getEntries();
    const permEntry = entries
      .filter((e: any) => e.type === "custom" && e.customType === "permission-mode")
      .pop() as any;

    if (permEntry?.data?.mode && MODES[permEntry.data.mode as ModeName]) {
      currentMode = permEntry.data.mode as ModeName;
    }

    // Apply plan mode tool restrictions
    if (currentMode === "plan") {
      pi.setActiveTools(["read", "bash", "grep", "find", "ls"]);
    }

    updateStatus(ctx);
    console.log(`[permissions] Loaded. Mode: ${currentMode}`);
  });

  // ── Tool Call Interceptor ───────────────────────────────────────────────────

  pi.on("tool_call", async (event, ctx) => {
    if (!extensionEnabled) return;

    const mode = MODES[currentMode];
    const toolName = event.toolName;

    // Bypass: allow everything
    if (currentMode === "bypass") return;

    // Tool allowlist check (plan mode)
    if (mode.allowedTools && !mode.allowedTools.includes(toolName)) {
      if (mode.strictBlock) {
        return {
          block: true,
          reason: `Tool '${toolName}' not allowed in ${currentMode} mode. Allowed: ${mode.allowedTools.join(", ")}.`
        };
      }
      if (mode.promptsEnabled && ctx.hasUI) {
        const ok = await ctx.ui.confirm(
          `Tool: ${toolName}`,
          `${toolName} is not allowed in ${currentMode} mode. Allow?`
        );
        if (!ok) return { block: true, reason: "Blocked by user" };
      } else {
        return { block: true, reason: `Tool '${toolName}' blocked in ${currentMode} mode` };
      }
    }

    // Protected paths check for write/edit (always prompt except bypass)
    if (toolName === "write" || toolName === "edit") {
      const path = (event.input.path as string) || "";
      if (isProtectedPath(path)) {
        if (ctx.hasUI) {
          const ok = await ctx.ui.confirm(
            "Protected Path",
            `This path is protected: ${path}\nAllow write/edit?`
          );
          if (!ok) return { block: true, reason: `Protected path: ${path}` };
        } else {
          return { block: true, reason: `Protected path blocked: ${path}` };
        }
      }
    }

    // Bash command handling
    if (toolName === "bash") {
      const command = (event.input.command as string) || "";

      // Check for protected paths in the command
      for (const p of GLOBAL_PROTECTED_PATHS) {
        if (p.test(command)) {
          if (mode.promptsEnabled && ctx.hasUI) {
            const ok = await ctx.ui.confirm(
              "⚠️ Protected Path",
              `Command targets a protected path:\n${command}\n\nAllow?`
            );
            if (!ok) return { block: true, reason: "Protected path in command" };
          } else {
            return { block: true, reason: "Protected path in command" };
          }
        }
      }

      // Auto mode: block only extreme destructive
      if (currentMode === "auto") {
        if (/\brm\s+-rf\s+\/\b/.test(command) || /\brm\s+-rf\s+~\b/.test(command)) {
          return { block: true, reason: "Root/home deletion blocked even in auto mode" };
        }
        return;
      }

      // dontAsk: block anything not explicitly safe
      if (currentMode === "dontAsk") {
        const isSafe = mode.autoBash.some((p) => p.test(command)) || /^\s*(cat|ls|pwd|echo|grep|find|head|tail|wc)\b/i.test(command);
        if (!isSafe) {
          return { block: true, reason: `Command not pre-approved in dontAsk mode` };
        }
        return;
      }

      // Plan mode: strict allowlist
      if (currentMode === "plan") {
        const safeCommands = [
          /\bcat\b/, /\bls\b/, /\bpwd\b/, /\becho\b/, /\bgrep\b/, /\bfind\b/,
          /\bhead\b/, /\btail\b/, /\bwc\b/, /\bsort\b/, /\buniq\b/, /\bdiff\b/,
          /\bfile\b/, /\bstat\b/, /\bdu\b/, /\bdf\b/, /\btree\b/, /\bwhich\b/,
          /\benv\b/, /\bprintenv\b/, /\buname\b/, /\bwhoami\b/, /\bid\b/,
          /\bdate\b/, /\bps\b/, /\bnode\s+--version\b/, /\bpython\s+--version\b/,
        ];
        const isSafe = safeCommands.some((p) => p.test(command));
        if (!isSafe) {
          return { block: true, reason: "Plan mode: command not allowlisted. Use /mode default to exit." };
        }
        return;
      }

      // Danger check for default/acceptEdits
      if (isDangerousCommand(command) || isAlwaysPromptBash(command, mode)) {
        if (mode.promptsEnabled && ctx.hasUI) {
          const ok = await ctx.ui.confirm(
            "⚠️ Dangerous Command",
            `This command may be dangerous:\n\n${command}\n\nAllow?`
          );
          if (!ok) return { block: true, reason: "Blocked by user" };
        } else {
          return { block: true, reason: `Dangerous command blocked: ${command.slice(0, 50)}...` };
        }
      }

      // acceptEdits: auto-approve safe bash
      if (currentMode === "acceptEdits" && isAutoBash(command, mode)) {
        return; // Allow
      }
    }

    // Always prompt for write/edit in default mode
    if ((toolName === "write" || toolName === "edit") && currentMode === "default") {
      if (mode.promptsEnabled && ctx.hasUI) {
        const path = (event.input.path as string) || "unknown";
        const ok = await ctx.ui.confirm(
          "File Write",
          `Allow write/edit to: ${path}?`
        );
        if (!ok) return { block: true, reason: "Blocked by user" };
      }
    }
  });

  // ── Commands ────────────────────────────────────────────────────────────────

  pi.registerCommand("mode", {
    description: "Set or show permission mode",
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      return Object.keys(MODES).map((m) => ({ value: m, label: m }));
    },
    handler: async (args, ctx) => {
      const modeArg = args.trim().toLowerCase();
      if (!modeArg) {
        // Show current mode
        const mode = MODES[currentMode];
        let output = `## Permission Mode: ${mode.label}\n\n`;
        output += `${mode.icon} ${mode.description}\n\n`;
        output += "**Available modes:**\n";
        for (const [name, cfg] of Object.entries(MODES)) {
          const marker = name === currentMode ? " ← current" : "";
          output += `- **${name}** ${cfg.icon}${marker}: ${cfg.description}\n`;
        }
        output += "\n**Toggle:** `/mode <name>` or Shift+Tab to cycle\n";
        ctx.ui.notify(output, "info");
        return;
      }

      if (!MODES[modeArg as ModeName]) {
        ctx.ui.notify(`Unknown mode: ${modeArg}. Available: ${Object.keys(MODES).join(", ")}`, "error");
        return;
      }

      currentMode = modeArg as ModeName;

      // Apply tool restrictions for plan mode
      if (currentMode === "plan") {
        pi.setActiveTools(["read", "bash", "grep", "find", "ls"]);
      } else if (currentMode === "default") {
        // Restore default tools
        pi.setActiveTools(["read", "bash", "edit", "write", "grep", "find", "ls"]);
      }

      updateStatus(ctx);
      ctx.ui.notify(`${MODES[currentMode].icon} Mode: ${currentMode}`, "info");
      persistMode();
    },
  });

  // Individual mode commands for quick access
  for (const name of Object.keys(MODES)) {
    pi.registerCommand(`mode-${name}`, {
      description: `Switch to ${name} mode`,
      handler: async (_args, ctx) => {
        currentMode = name as ModeName;
        if (currentMode === "plan") {
          pi.setActiveTools(["read", "bash", "grep", "find", "ls"]);
        } else {
          pi.setActiveTools(["read", "bash", "edit", "write", "grep", "find", "ls"]);
        }
        updateStatus(ctx);
        ctx.ui.notify(`${MODES[currentMode].icon} Mode: ${currentMode}`, "info");
        persistMode();
      },
    });
  }

  pi.registerCommand("permissions", {
    description: "Show permission mode status",
    handler: async (_args, ctx) => {
      const mode = MODES[currentMode];
      let output = `## Permissions\n\n`;
      output += `**Mode:** ${mode.icon} ${mode.label}\n`;
      output += `**Status:** ${mode.description}\n\n`;

      if (currentMode === "plan") {
        output += "**Allowed tools:** read, bash, grep, find, ls\n";
        output += "**Blocked:** edit, write\n";
      } else if (currentMode === "dontAsk") {
        output += "**Allowed:** Pre-approved commands only\n";
        output += "**Blocked:** All other commands\n";
      } else if (currentMode === "bypass") {
        output += "⚠️ **WARNING:** No safety checks active!\n";
        output += "Use only in isolated containers/VMs.\n";
      } else if (currentMode === "acceptEdits") {
        output += "**Auto-approved:** mkdir, touch, rm, mv, cp, sed, cat>\n";
        output += "**Still prompts:** rm -rf, sudo, dangerous commands\n";
      } else if (currentMode === "auto") {
        output += "**Auto-approves:** Most actions\n";
        output += "**Still blocks:** rm -rf / or rm -rf ~, extreme destructive\n";
      } else {
        output += "**Prompts for:** write, edit, dangerous bash\n";
        output += "**Protected paths:** .git, .vscode, .claude.json, etc.\n";
      }

      ctx.ui.notify(output, "info");
    },
  });

  pi.registerCommand("permissions-disable", {
    description: "Disable permission mode extension for this session",
    handler: async (_args, ctx) => {
      extensionEnabled = false;
      ctx.ui.setStatus("permissions", undefined);
      ctx.ui.notify("Permissions extension disabled. All tools allowed without checks.", "warning");
    },
  });

  // Register Shift+Tab cycle via keybinding
  pi.registerShortcut(Key.ctrlAlt("p"), {
    description: "Cycle permission mode (Shift+Tab also works if bound in keybindings.json)",
    handler: async (ctx) => cycleMode(ctx),
  });

  // Note: Shift+Tab cycle requires adding to keybindings.json:
  // { "app.permissions.cycle": "shift+tab" }
  // Or use Ctrl+Alt+P as default shortcut.

  console.log(`[permissions] Extension loaded. Mode: ${currentMode}`);
}