/**
 * Pi Extension: Chat-Tree Integration v2.0
 * 
 * Complete extension for daily AI conversation management.
 * Bridges PI's session tree with Obsidian's Chat-Tree vault structure.
 * 
 * Structure:
 *   Chat-Trees/
 *   ├── .session-mapping.json
 *   ├── <trunk>/
 *   │   ├── trunk.md
 *   │   ├── <branch>/
 *   │   │   ├── branch-index.md
 *   │   │   ├── Turn-001.md
 *   │   │   └── Turn-001-fruits/
 */

import * as fs from 'fs';
import * as path from 'path';

// ==================== Configuration ====================

interface ChatTreeConfig {
  vaultPath: string;
  chatTreeRoot: string;
  autoSave: boolean;
  defaultModel: string;
}

const DEFAULT_CONFIG: ChatTreeConfig = {
  vaultPath: "/mnt/c/Users/andre/Documents/VonStegen-Master-Vault",
  chatTreeRoot: "AI/Chat-Trees",
  autoSave: true,
  defaultModel: "claude"
};

// ==================== State ====================

let config: ChatTreeConfig = { ...DEFAULT_CONFIG };
let currentTrunk: string = "";
let currentBranch: string = "main";
let pendingExchange: {
  prompt: string;
  response: string;
  model: string;
  tokens: number;
  timestamp: string;
} | null = null;
let piSessionFile: string | null = null;
let piSessionId: string | null = null;
let searchCache: Map<string, any[]> = new Map();
let lastSearchCache = 0;

// ==================== Path Helpers ====================

function getChatTreesPath(): string {
  return path.join(config.vaultPath, config.chatTreeRoot);
}

function getTrunkPath(trunkName: string): string {
  return path.join(getChatTreesPath(), trunkName);
}

function getBranchPath(trunkName: string, branchName: string): string {
  return path.join(getTrunkPath(trunkName), branchName);
}

function getTurnPath(trunkName: string, branchName: string, turnNumber: number): string {
  return path.join(getBranchPath(trunkName, branchName), "Turn-" + String(turnNumber).padStart(3, '0') + ".md");
}

function getFruitsPath(trunkName: string, branchName: string, turnNumber: number): string {
  return path.join(getBranchPath(trunkName, branchName), "Turn-" + String(turnNumber).padStart(3, '0') + "-fruits");
}

// ==================== Session <-> Trunk Mapping ====================

function getSessionMappingPath(): string {
  return path.join(getChatTreesPath(), '.session-mapping.json');
}

interface SessionMapping {
  [piSessionFile: string]: {
    trunkName: string;
    branch: string;
    createdAt: string;
    lastAccess: string;
  };
}

function loadSessionMapping(): SessionMapping {
  try {
    const content = fs.readFileSync(getSessionMappingPath(), 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

function saveSessionMapping(mapping: SessionMapping): void {
  ensureDir(getChatTreesPath());
  fs.writeFileSync(getSessionMappingPath(), JSON.stringify(mapping, null, 2), 'utf-8');
}

function getTrunkForSession(sessionFile: string): { trunk: string; branch: string } | null {
  const mapping = loadSessionMapping();
  const entry = mapping[sessionFile];
  if (entry) {
    entry.lastAccess = new Date().toISOString();
    saveSessionMapping(mapping);
    return { trunk: entry.trunkName, branch: entry.branch };
  }
  return null;
}

function setTrunkForSession(sessionFile: string, trunkName: string, branch: string): void {
  const mapping = loadSessionMapping();
  if (!mapping[sessionFile]) {
    mapping[sessionFile] = { createdAt: new Date().toISOString() };
  }
  mapping[sessionFile].trunkName = trunkName;
  mapping[sessionFile].branch = branch;
  mapping[sessionFile].lastAccess = new Date().toISOString();
  saveSessionMapping(mapping);
}

// ==================== File System Operations ====================

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function listTurns(trunkName: string, branchName: string): string[] {
  const branchPath = getBranchPath(trunkName, branchName);
  try {
    const files = fs.readdirSync(branchPath);
    return files
      .filter(f => /^Turn-\d{3}\.md$/.test(f))
      .sort();
  } catch {
    return [];
  }
}

function getTurnContent(trunkName: string, branchName: string, turnNumber: number): string | null {
  const turnPath = getTurnPath(trunkName, branchName, turnNumber);
  try {
    return fs.readFileSync(turnPath, 'utf-8');
  } catch {
    return null;
  }
}

function getNextTurnNumber(trunkName: string, branchName: string): number {
  const turns = listTurns(trunkName, branchName);
  if (turns.length === 0) return 1;
  const lastTurn = turns[turns.length - 1];
  const match = lastTurn.match(/Turn-(\d{3})\.md/);
  return match ? parseInt(match[1], 10) + 1 : 1;
}

function listBranches(trunkName: string): string[] {
  const trunkPath = getTrunkPath(trunkName);
  try {
    return fs.readdirSync(trunkPath)
      .filter(f => {
        const fPath = path.join(trunkPath, f);
        return fs.statSync(fPath).isDirectory() && !f.startsWith('.');
      })
      .sort();
  } catch {
    return ['main'];
  }
}

function listTrunks(): string[] {
  const chatTreesPath = getChatTreesPath();
  ensureDir(chatTreesPath);
  try {
    return fs.readdirSync(chatTreesPath)
      .filter(f => {
        const fPath = path.join(chatTreesPath, f);
        return fs.statSync(fPath).isDirectory() && !f.startsWith('.');
      })
      .sort();
  } catch {
    return [];
  }
}

// ==================== Turn Content Parsing ====================

interface TurnMetadata {
  id: string;
  type: string;
  timestamp: string;
  branch: string;
  parent_turn: string | null;
  model: string;
  success_score: number | null;
  tags: string[];
  fruits: string[];
  pi_session: string | null;
  pi_session_file: string | null;
  prompt: string;
  response: string;
  content: string;
  trunk: string;
  branchName: string;
  turnPath: string;
}

function parseTurnMetadata(content: string, trunk: string, branchName: string, turnPath: string): TurnMetadata | null {
  const lines = content.split('\n');
  const metadata: Partial<TurnMetadata> = {
    content,
    trunk,
    branchName,
    turnPath,
    tags: [],
    fruits: [],
    pi_session: null,
    pi_session_file: null,
    prompt: '',
    response: ''
  };

  let inFrontmatter = false;
  let inPrompt = false;
  let inResponse = false;
  let frontmatterKey = '';
  let frontmatterValue = '';
  let promptLines: string[] = [];
  let responseLines: string[] = [];

  for (const line of lines) {
    if (line === '---') {
      if (!inFrontmatter) {
        inFrontmatter = true;
        continue;
      } else {
        inFrontmatter = false;
        continue;
      }
    }

    if (inFrontmatter) {
      // Parse frontmatter key: value
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        frontmatterKey = line.substring(0, colonIdx).trim();
        frontmatterValue = line.substring(colonIdx + 1).trim();

        switch (frontmatterKey) {
          case 'id': metadata.id = frontmatterValue; break;
          case 'type': metadata.type = frontmatterValue; break;
          case 'timestamp': metadata.timestamp = frontmatterValue; break;
          case 'branch': metadata.branch = frontmatterValue; break;
          case 'parent_turn': metadata.parent_turn = frontmatterValue || null; break;
          case 'model': metadata.model = frontmatterValue; break;
          case 'success_score':
            metadata.success_score = frontmatterValue ? parseFloat(frontmatterValue) : null;
            break;
          case 'tags':
            metadata.tags = frontmatterValue
              .replace(/[\[\]]/g, '')
              .split(',')
              .map(t => t.trim().replace(/['"]/g, ''))
              .filter(t => t);
            break;
          case 'fruits':
            metadata.fruits = frontmatterValue
              .replace(/[\[\]]/g, '')
              .split(',')
              .map(f => f.trim().replace(/['"]/g, ''))
              .filter(f => f);
            break;
          case 'pi_session': metadata.pi_session = frontmatterValue || null; break;
          case 'pi_session_file': metadata.pi_session_file = frontmatterValue || null; break;
        }
      }
    } else {
      // Parse content sections
      if (line === '## Prompt') {
        inPrompt = true;
        inResponse = false;
        continue;
      }
      if (line === '## Response') {
        inPrompt = false;
        inResponse = true;
        continue;
      }
      if (line === '## Fruits') {
        inPrompt = false;
        inResponse = false;
        continue;
      }
      if (line.startsWith('# ')) {
        metadata.id = line.substring(2).trim();
        continue;
      }

      if (inPrompt) {
        promptLines.push(line);
      } else if (inResponse) {
        responseLines.push(line);
      }
    }
  }

  if (!metadata.id) return null;

  metadata.prompt = promptLines.join('\n').trim();
  metadata.response = responseLines.join('\n').trim();

  return metadata as TurnMetadata;
}

// ==================== Index All Turns ====================

function indexAllTurns(): TurnMetadata[] {
  const allTurns: TurnMetadata[] = [];
  const trunks = listTrunks();

  for (const trunk of trunks) {
    const branches = listBranches(trunk);
    for (const branch of branches) {
      const turns = listTurns(trunk, branch);
      for (const turnFile of turns) {
        const match = turnFile.match(/Turn-(\d{3})\.md/);
        if (match) {
          const turnNum = parseInt(match[1], 10);
          const content = getTurnContent(trunk, branch, turnNum);
          if (content) {
            const turnPath = getTurnPath(trunk, branch, turnNum);
            const parsed = parseTurnMetadata(content, trunk, branch, turnPath);
            if (parsed) {
              allTurns.push(parsed);
            }
          }
        }
      }
    }
  }

  return allTurns;
}

// ==================== Search Operations ====================

function searchTurns(query: string, options: {
  trunk?: string;
  branch?: string;
  model?: string;
  minScore?: number;
  tags?: string[];
  limit?: number;
} = {}): TurnMetadata[] {
  const { trunk, branch, model, minScore, tags, limit = 50 } = options;
  const queryLower = query.toLowerCase();
  const allTurns = indexAllTurns();
  const results: Array<{ turn: TurnMetadata; score: number }> = [];

  for (const turn of allTurns) {
    let score = 0;
    let skip = false;

    // Filter by trunk/branch
    if (trunk && turn.trunk !== trunk) skip = true;
    if (branch && turn.branchName !== branch) skip = true;
    if (model && turn.model !== model) skip = true;
    if (minScore && (turn.success_score === null || turn.success_score < minScore)) skip = true;
    if (tags && tags.length > 0) {
      const hasTag = tags.some(t => turn.tags.includes(t));
      if (!hasTag) skip = true;
    }

    if (skip) continue;

    // Score by relevance
    if (turn.id.toLowerCase().includes(queryLower)) score += 10;
    if (turn.prompt.toLowerCase().includes(queryLower)) score += 5;
    if (turn.response.toLowerCase().includes(queryLower)) score += 3;
    if (turn.trunk.toLowerCase().includes(queryLower)) score += 2;
    if (turn.tags.some(t => t.toLowerCase().includes(queryLower))) score += 2;

    if (score > 0) {
      results.push({ turn, score });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  return results.slice(0, limit).map(r => r.turn);
}

// ==================== Ancestry Operations ====================

function getAncestors(trunk: string, branch: string, turnNumber: number): TurnMetadata[] {
  const ancestors: TurnMetadata[] = [];
  let currentTurn = turnNumber - 1;

  while (currentTurn >= 1) {
    const content = getTurnContent(trunk, branch, currentTurn);
    if (!content) break;

    const turnPath = getTurnPath(trunk, branch, currentTurn);
    const parsed = parseTurnMetadata(content, trunk, branch, turnPath);
    if (parsed) {
      ancestors.push(parsed);
      currentTurn--;
    } else {
      break;
    }
  }

  return ancestors;
}

function getChildren(trunk: string, branch: string, turnNumber: number): TurnMetadata[] {
  const children: TurnMetadata[] = [];
  const turnId = "Turn-" + String(turnNumber).padStart(3, '0');
  const allTurns = indexAllTurns();

  for (const turn of allTurns) {
    if (turn.parent_turn === turnId && turn.trunk === trunk && turn.branchName === branch) {
      children.push(turn);
    }
  }

  return children;
}

function getTurnById(turnId: string): TurnMetadata | null {
  const allTurns = indexAllTurns();
  return allTurns.find(t => t.id === turnId) || null;
}

// ==================== Turn Update Operations ====================

function updateTurnMetadata(turn: TurnMetadata, updates: {
  success_score?: number | null;
  tags?: string[];
  fruits?: string[];
}): boolean {
  try {
    let content = turn.content;

    // Update success_score
    if (updates.success_score !== undefined) {
      const scoreStr = updates.success_score !== null ? String(updates.success_score) : '';
      if (content.includes('success_score:')) {
        content = content.replace(/success_score:.*\n/, 'success_score: ' + scoreStr + '\n');
      }
    }

    // Update tags
    if (updates.tags !== undefined) {
      const tagsStr = '[' + updates.tags.map(t => '"' + t + '"').join(', ') + ']';
      if (content.includes('tags:')) {
        content = content.replace(/tags:.*\n/, 'tags: ' + tagsStr + '\n');
      }
    }

    // Update fruits
    if (updates.fruits !== undefined) {
      const fruitsStr = '[' + updates.fruits.map(f => '"' + f + '"').join(', ') + ']';
      if (content.includes('fruits:')) {
        content = content.replace(/fruits:.*\n/, 'fruits: ' + fruitsStr + '\n');
      }
    }

    fs.writeFileSync(turn.turnPath, content, 'utf-8');
    return true;
  } catch (e) {
    console.error("[Chat-Tree] Error updating turn:", e);
    return false;
  }
}


// ==================== Save Operations ====================

function generateTurnId(turnNumber: number): string {
  return "Turn-" + String(turnNumber).padStart(3, '0');
}

function formatTurnMarkdown(
  turnId: string,
  branchName: string,
  parentTurn: string | null,
  model: string,
  prompt: string,
  response: string,
  fruits: string[] = [],
  sessionId: string | null = null,
  sessionFile: string | null = null
): string {
  const timestamp = new Date().toISOString();
  
  let md = '---\n';
  md += "type: turn\n";
  md += "id: " + turnId + "\n";
  md += "timestamp: " + timestamp + "\n";
  md += "branch: " + branchName + "\n";
  md += "parent_turn: " + (parentTurn || '') + "\n";
  md += "model: " + model + "\n";
  md += "success_score: \n";
  md += "tags: []\n";
  md += "fruits: [" + fruits.map(f => '"' + f + '"').join(', ') + "]\n";
  if (sessionId) {
    md += "pi_session: " + sessionId + "\n";
  }
  if (sessionFile) {
    md += "pi_session_file: " + sessionFile + "\n";
  }
  md += "---\n\n";

  md += "# " + turnId + "\n\n";
  md += "## Prompt\n\n" + prompt + "\n\n";
  md += "## Response\n\n" + response + "\n\n";

  if (fruits.length > 0) {
    md += "## Fruits\n\n";
    for (const fruit of fruits) {
      md += "- [[" + fruit + "]]\n";
    }
  }

  return md;
}

function formatTrunkMarkdown(trunkName: string, sessionId: string | null = null): string {
  return "---\ntype: trunk\nid: " + (sessionId || trunkName.toLowerCase().replace(/[^a-z0-9]+/g, '-')) + "\ntimestamp: " + new Date().toISOString() + "\nmodel: " + config.defaultModel + "\n---\n\n# " + trunkName + "\n\nCreated by PI Chat-Tree extension\n";
}

function formatBranchIndex(branchName: string, trunkName: string): string {
  return "---\ntype: branch\nid: " + branchName + "\ntrunk: " + trunkName + "\ntimestamp: " + new Date().toISOString() + "\n---\n\n# Branch: " + branchName + "\n";
}

function saveTurn(
  trunkName: string,
  branchName: string,
  prompt: string,
  response: string,
  model: string,
  parentTurn: string | null = null,
  fruits: string[] = [],
  sessionId: string | null = null,
  sessionFile: string | null = null
): { turnId: string; turnNumber: number; turnPath: string } | null {
  try {
    ensureDir(getChatTreesPath());
    ensureDir(getTrunkPath(trunkName));
    ensureDir(getBranchPath(trunkName, branchName));

    // Create trunk.md if needed
    const trunkPath = path.join(getTrunkPath(trunkName), 'trunk.md');
    if (!fs.existsSync(trunkPath)) {
      fs.writeFileSync(trunkPath, formatTrunkMarkdown(trunkName, sessionId), 'utf-8');
    }

    // Create branch index if needed
    const branchIndexPath = path.join(getBranchPath(trunkName, branchName), 'branch-index.md');
    if (!fs.existsSync(branchIndexPath)) {
      fs.writeFileSync(branchIndexPath, formatBranchIndex(branchName, trunkName), 'utf-8');
    }

    const turnNumber = getNextTurnNumber(trunkName, branchName);
    const turnId = generateTurnId(turnNumber);

    const markdown = formatTurnMarkdown(turnId, branchName, parentTurn, model, prompt, response, fruits, sessionId, sessionFile);
    const turnPath = getTurnPath(trunkName, branchName, turnNumber);
    fs.writeFileSync(turnPath, markdown, 'utf-8');

    // Create fruits directory
    const fruitsPath = getFruitsPath(trunkName, branchName, turnNumber);
    ensureDir(fruitsPath);

    return { turnId, turnNumber, turnPath };
  } catch (e) {
    console.error("[Chat-Tree] Error saving turn:", e);
    return null;
  }
}

function saveFruit(
  trunkName: string,
  branchName: string,
  turnNumber: number,
  filename: string,
  content: string
): string | null {
  try {
    const fruitsPath = getFruitsPath(trunkName, branchName, turnNumber);
    ensureDir(fruitsPath);

    const fruitPath = path.join(fruitsPath, filename);
    fs.writeFileSync(fruitPath, content, 'utf-8');

    return fruitPath;
  } catch (e) {
    console.error("[Chat-Tree] Error saving fruit:", e);
    return null;
  }
}

// ==================== Tree Visualization ====================

function renderTree(trunkName: string, showDetails: boolean = false): string {
  const branches = listBranches(trunkName);
  let output = "## Tree: [[" + trunkName + "]]\n\n";
  const totalTurns = branches.reduce((sum, b) => sum + listTurns(trunkName, b).length, 0);

  output += "**" + branches.length + "** branches, **" + totalTurns + "** turns\n\n";

  for (const branch of branches) {
    const turns = listTurns(trunkName, branch);
    const marker = branch === currentBranch ? " <- current" : "";
    output += "### [[" + branch + "]]" + marker + "\n";

    for (const turnFile of turns) {
      const match = turnFile.match(/Turn-(\d{3})/);
      if (match) {
        const turnNum = parseInt(match[1], 10);
        const content = getTurnContent(trunkName, branch, turnNum);
        
        if (showDetails && content) {
          const parsed = parseTurnMetadata(content, trunkName, branch, getTurnPath(trunkName, branch, turnNum));
          if (parsed) {
            const preview = parsed.prompt.substring(0, 80).replace(/\n/g, ' ') + (parsed.prompt.length > 80 ? '...' : '');
            const score = parsed.success_score !== null ? " ★" + parsed.success_score : "";
            const tags = parsed.tags.length > 0 ? " [" + parsed.tags.join(', ') + "]" : "";
            output += "- [[" + turnFile.replace('.md', '') + "]]" + score + tags + "\n  > " + preview + "\n";
          }
        } else {
          output += "- [[" + turnFile.replace('.md', '') + "]]\n";
        }
      }
    }
    
    if (turns.length === 0) {
      output += "- (no turns yet)\n";
    }
    output += "\n";
  }

  return output;
}

// ==================== Statistics ====================

function getStats(): {
  trunks: number;
  branches: number;
  turns: number;
  averageScore: number;
  taggedTurns: number;
  totalTokens: number;
} {
  const allTurns = indexAllTurns();
  let totalScore = 0;
  let scoreCount = 0;
  let taggedCount = 0;
  const branches = new Set<string>();

  for (const turn of allTurns) {
    if (turn.success_score !== null) {
      totalScore += turn.success_score;
      scoreCount++;
    }
    if (turn.tags.length > 0) taggedCount++;
    branches.add(turn.trunk + "/" + turn.branchName);
  }

  return {
    trunks: listTrunks().length,
    branches: branches.size,
    turns: allTurns.length,
    averageScore: scoreCount > 0 ? Math.round((totalScore / scoreCount) * 10) / 10 : 0,
    taggedTurns: taggedCount,
    totalTokens: 0 // Would need to track this
  };
}


// ==================== Export ====================

export default function chatTreeExtension(pi: any) {
  
  console.log("[Chat-Tree] Extension loading...");

  // ==================== Session Event Handlers ====================

  pi.on("session_start", async (event: any, ctx: any) => {
    try {
      if (ctx.sessionManager) {
        const sessionFile = (ctx as any).sessionManager?.sessionFile || 
                           event.sessionFile;
        if (sessionFile) {
          piSessionFile = sessionFile;
          piSessionId = path.basename(sessionFile, path.extname(sessionFile));
          
          const mapping = getTrunkForSession(sessionFile);
          if (mapping) {
            currentTrunk = mapping.trunk;
            currentBranch = mapping.branch;
            console.log("[Chat-Tree] Resumed: " + currentTrunk + "/" + currentBranch);
          } else {
            currentTrunk = piSessionId || "session-" + Date.now().toString(36);
            currentBranch = "main";
            setTrunkForSession(sessionFile, currentTrunk, currentBranch);
            console.log("[Chat-Tree] New trunk: " + currentTrunk);
          }
        }
      }
    } catch (e) {
      console.log("[Chat-Tree] Could not get session info:", e);
    }
  });

  pi.on("session_shutdown", async (event: any, ctx: any) => {
    if (piSessionFile && currentTrunk) {
      setTrunkForSession(piSessionFile, currentTrunk, currentBranch);
      console.log("[Chat-Tree] Session saved: " + currentTrunk);
    }
  });

  pi.on("session_start", async (event: any, ctx: any) => {
    if (event.reason === 'fork' && currentTrunk) {
      const forkBranch = "fork-" + Date.now().toString(36);
      ensureDir(getBranchPath(currentTrunk, forkBranch));
      currentBranch = forkBranch;
      setTrunkForSession(piSessionFile!, currentTrunk, currentBranch);
      console.log("[Chat-Tree] Created branch: " + forkBranch);
    }
  });

  // ==================== Core Commands ====================

  pi.registerCommand("ct", {
    description: "Chat Tree status and overview",
    handler: (args: string) => {
      const stats = getStats();
      const trunks = listTrunks();
      
      let output = "## Chat Tree Status\n\n";
      output += "**PI Session**: [[" + (piSessionId || "none") + "]]\n";
      output += "**Current**: [[" + (currentTrunk || "none") + "/" + currentBranch + "]]\n\n";
      output += "### Vault Stats\n";
      output += "- Trunks: " + stats.trunks + "\n";
      output += "- Branches: " + stats.branches + "\n";
      output += "- Turns: " + stats.turns + "\n";
      if (stats.taggedTurns > 0) {
        output += "- Tagged: " + stats.taggedTurns + "\n";
      }
      if (stats.averageScore > 0) {
        output += "- Avg Score: " + stats.averageScore + "\n";
      }
      
      output += "\n### Commands\n";
      output += "```\n";
      output += "/ct help              - Show all commands\n";
      output += "/ct status           - Detailed stats\n";
      output += "/ct trunks           - List trunks\n";
      output += "/ct branches [trunk] - List branches\n";
      output += "/ct turns [branch]   - List turns\n";
      output += "/ct tree [trunk]     - Show tree\n";
      output += "/ct search <query>   - Search turns\n";
      output += "/ct new <name>       - New trunk\n";
      output += "/ct use <trunk> [b]  - Set context\n";
      output += "/ct save             - Save exchange\n";
      output += "/ct rate <turn> <1-5> - Rate turn\n";
      output += "/ct tag <turn> <tag> - Tag turn\n";
      output += "/ct ancestors <turn> - Show ancestry\n";
      output += "/ct children <turn> - Show children\n";
      output += "/ct node <id>        - Load node\n";
      output += "/ct sessions        - PI session mappings\n";
      output += "/fruit <turn> <f> <c> - Save fruit\n";
      output += "```\n";
      
      output += "\n**Vault**: " + config.vaultPath + "\n";
      output += "**Auto-save**: " + (config.autoSave ? "on" : "off") + "\n";

      return { content: [{ type: "text", text: output }] };
    }
  });

  pi.registerCommand("chat-tree", {
    description: "Alias for /ct",
    handler: (args: string, ctx: any) => {
      return pi.commands.get("ct")?.handler(args, ctx);
    }
  });

  pi.registerCommand("ct help", {
    description: "Show all Chat-Tree commands",
    handler: (args: string) => {
      let output = "## Chat-Tree Commands\n\n";
      
      output += "### Status & Info\n";
      output += "- `/ct` - Status overview\n";
      output += "- `/ct status` - Detailed statistics\n";
      output += "- `/ct help` - This help\n";
      output += "- `/ct sessions` - PI session mappings\n";
      
      output += "\n### Navigation\n";
      output += "- `/ct trunks` - List all trunks\n";
      output += "- `/ct branches [trunk]` - List branches in trunk\n";
      output += "- `/ct turns [branch]` - List turns in branch\n";
      output += "- `/ct tree [trunk]` - Show tree structure\n";
      output += "- `/ct node <id>` - Load node content\n";
      
      output += "\n### Context\n";
      output += "- `/ct use <trunk> [branch]` - Set current trunk/branch\n";
      output += "- `/ct new <name>` - Create new trunk\n";
      output += "- `/ct branch <name>` - Create new branch\n";
      
      output += "\n### Search & Explore\n";
      output += "- `/ct search <query>` - Search turns\n";
      output += "- `/ct ancestors <turn>` - Show parent chain\n";
      output += "- `/ct children <turn>` - Show child turns\n";
      output += "- `/ct recent [count]` - Show recent turns\n";
      
      output += "\n### Quality & Tagging\n";
      output += "- `/ct rate <turn> <1-5>` - Rate turn quality\n";
      output += "- `/ct tag <turn> <tag>` - Add tag to turn\n";
      output += "- `/ct untag <turn> <tag>` - Remove tag\n";
      output += "- `/ct tags [pattern]` - List all tags\n";
      
      output += "\n### Save & Capture\n";
      output += "- `/ct save` - Save pending exchange\n";
      output += "- `/fruit <turn> <filename> <content>` - Save fruit\n";
      
      output += "\n### Config\n";
      output += "- `/ct config vault <path>` - Set vault path\n";
      output += "- `/ct config autosave on|off` - Toggle auto-save\n";

      return { content: [{ type: "text", text: output }] };
    }
  });

  pi.registerCommand("ct status", {
    description: "Detailed statistics",
    handler: (args: string) => {
      const stats = getStats();
      const allTurns = indexAllTurns();
      const trunks = listTrunks();
      
      let output = "## Chat-Tree Statistics\n\n";
      output += "| Metric | Value |\n";
      output += "|--------|-------|\n";
      output += "| Trunks | " + stats.trunks + " |\n";
      output += "| Branches | " + stats.branches + " |\n";
      output += "| Total Turns | " + stats.turns + " |\n";
      output += "| Tagged Turns | " + stats.taggedTurns + " |\n";
      output += "| Average Score | " + stats.averageScore + " |\n";
      output += "| PI Session | " + (piSessionId || "-") + " |\n";
      output += "| Current Trunk | [[" + currentTrunk + "]] |\n";
      output += "| Current Branch | [[" + currentBranch + "]] |\n";
      
      output += "\n### Trunk Summary\n";
      for (const trunk of trunks) {
        const branches = listBranches(trunk);
        let turnCount = 0;
        for (const branch of branches) {
          turnCount += listTurns(trunk, branch).length;
        }
        output += "- [[" + trunk + "]]: " + branches.length + " branches, " + turnCount + " turns\n";
      }
      
      return { content: [{ type: "text", text: output }] };
    }
  });


  // ==================== Listing Commands ====================

  pi.registerCommand("ct trunks", {
    description: "List all trunks",
    handler: (args: string) => {
      const trunks = listTrunks();
      if (trunks.length === 0) {
        return { content: [{ type: "text", text: "No trunks found. Use `/ct new <name>` to create one." }] };
      }

      let output = "## Trunks\n\n";
      for (const trunk of trunks) {
        const branches = listBranches(trunk);
        let turnCount = 0;
        for (const branch of branches) {
          turnCount += listTurns(trunk, branch).length;
        }
        const marker = trunk === currentTrunk ? " <- current" : "";
        output += "- [[" + trunk + "]]" + marker + " (" + branches.length + " branches, " + turnCount + " turns)\n";
      }

      return { content: [{ type: "text", text: output }] };
    }
  });

  pi.registerCommand("ct branches", {
    description: "List branches in a trunk",
    handler: (args: string) => {
      const trunk = args.trim() || currentTrunk;
      if (!trunk) {
        return { content: [{ type: "text", text: "No current trunk. Use `/ct trunks` to see available trunks." }] };
      }

      const branches = listBranches(trunk);
      let output = "## Branches in [[" + trunk + "]]\n\n";
      for (const branch of branches) {
        const turns = listTurns(trunk, branch);
        const marker = branch === currentBranch ? " <- current" : "";
        output += "- [[" + branch + "]]" + marker + " (" + turns.length + " turns)\n";
      }

      return { content: [{ type: "text", text: output }] };
    }
  });

  pi.registerCommand("ct turns", {
    description: "List turns in a branch",
    handler: (args: string) => {
      const parts = args.trim().split(/\s+/);
      const branch = parts[0] || currentBranch;
      const trunk = parts[1] || currentTrunk;

      if (!trunk || !branch) {
        return { content: [{ type: "text", text: "No current context. Use `/ct use <trunk> [branch]` first." }] };
      }

      const turns = listTurns(trunk, branch);
      if (turns.length === 0) {
        return { content: [{ type: "text", text: "No turns in [[" + branch + "]]. Start a conversation!" }] };
      }

      let output = "## Turns in [[" + trunk + "/" + branch + "]]\n\n";
      for (const turnFile of turns) {
        output += "- [[" + turnFile.replace('.md', '') + "]]\n";
      }

      return { content: [{ type: "text", text: output }] };
    }
  });

  pi.registerCommand("ct tree", {
    description: "Show tree structure",
    handler: (args: string) => {
      const parts = args.trim().split(/\s+/);
      const showDetails = parts.includes('-v') || parts.includes('--verbose');
      const trunk = parts.filter(p => !p.startsWith('-')).join('') || currentTrunk;
      
      if (!trunk) {
        return { content: [{ type: "text", text: "No current trunk. Use `/ct trunks` to select one." }] };
      }

      return { content: [{ type: "text", text: renderTree(trunk, showDetails) }] };
    }
  });

  // ==================== Search Commands ====================

  pi.registerCommand("ct search", {
    description: "Search turns",
    handler: (args: string) => {
      if (!args.trim()) {
        return { content: [{ type: "text", text: "Usage: `/ct search <query>`" }] };
      }

      // Parse options
      const options: any = {};
      const parts = args.trim().split(/\s+/);
      const queryParts: string[] = [];
      
      for (const part of parts) {
        if (part.startsWith('trunk:')) options.trunk = part.substring(6);
        else if (part.startsWith('branch:')) options.branch = part.substring(7);
        else if (part.startsWith('model:')) options.model = part.substring(6);
        else if (part.startsWith('score:')) options.minScore = parseFloat(part.substring(6));
        else if (part.startsWith('tag:')) options.tags = [part.substring(4)];
        else queryParts.push(part);
      }
      
      const query = queryParts.join(' ');
      if (!query) {
        return { content: [{ type: "text", text: "Usage: `/ct search <query>`" }] };
      }

      const results = searchTurns(query, options);
      
      if (results.length === 0) {
        return { content: [{ type: "text", text: "No turns found matching: " + query }] };
      }

      let output = "## Search: \"" + query + "\" (" + results.length + " results)\n\n";
      for (const turn of results.slice(0, 20)) {
        const preview = turn.prompt.substring(0, 60).replace(/\n/g, ' ') + (turn.prompt.length > 60 ? '...' : '');
        const score = turn.success_score !== null ? " ★" + turn.success_score : "";
        const tags = turn.tags.length > 0 ? " [" + turn.tags.slice(0, 3).join(', ') + "]" : "";
        output += "- [[" + turn.trunk + "/" + turn.id + "]]" + score + tags + "\n  > " + preview + "\n";
      }
      
      if (results.length > 20) {
        output += "\n_... and " + (results.length - 20) + " more results_\n";
      }

      return { content: [{ type: "text", text: output }] };
    }
  });

  pi.registerCommand("ct recent", {
    description: "Show recent turns",
    handler: (args: string) => {
      const count = parseInt(args.trim()) || 10;
      const allTurns = indexAllTurns();
      
      // Sort by timestamp descending
      allTurns.sort((a, b) => {
        const timeA = new Date(a.timestamp || 0).getTime();
        const timeB = new Date(b.timestamp || 0).getTime();
        return timeB - timeA;
      });

      const recent = allTurns.slice(0, count);
      
      if (recent.length === 0) {
        return { content: [{ type: "text", text: "No turns found." }] };
      }

      let output = "## Recent Turns (" + count + ")\n\n";
      for (const turn of recent) {
        const time = new Date(turn.timestamp).toLocaleDateString();
        const score = turn.success_score !== null ? " ★" + turn.success_score : "";
        const tags = turn.tags.length > 0 ? " [" + turn.tags.slice(0, 3).join(', ') + "]" : "";
        const preview = turn.prompt.substring(0, 50).replace(/\n/g, ' ') + (turn.prompt.length > 50 ? '...' : '');
        output += "- [[" + turn.trunk + "/" + turn.id + "]]" + score + tags + " (" + time + ")\n  > " + preview + "\n";
      }

      return { content: [{ type: "text", text: output }] };
    }
  });


  // ==================== Context Commands ====================

  pi.registerCommand("ct use", {
    description: "Set current trunk/branch",
    handler: (args: string) => {
      const parts = args.trim().split(/\s+/);
      const trunk = parts[0];
      const branch = parts[1] || 'main';

      if (!trunk) {
        return { content: [{ type: "text", text: "Usage: `/ct use <trunk> [branch]`" }] };
      }

      currentTrunk = trunk;
      currentBranch = branch;
      ensureDir(getBranchPath(trunk, branch));

      if (piSessionFile) {
        setTrunkForSession(piSessionFile, trunk, branch);
      }

      return { content: [{ type: "text", text: "Now using: [[" + trunk + "/" + branch + "]]" }] };
    }
  });

  pi.registerCommand("ct new", {
    description: "Create new trunk",
    handler: (args: string) => {
      const name = args.trim();
      if (!name) {
        return { content: [{ type: "text", text: "Usage: `/ct new <trunk-name>`" }] };
      }

      ensureDir(getBranchPath(name, 'main'));
      
      const trunkPath = path.join(getTrunkPath(name), 'trunk.md');
      if (!fs.existsSync(trunkPath)) {
        fs.writeFileSync(trunkPath, formatTrunkMarkdown(name, piSessionId), 'utf-8');
      }

      const branchIndexPath = path.join(getBranchPath(name, 'main'), 'branch-index.md');
      if (!fs.existsSync(branchIndexPath)) {
        fs.writeFileSync(branchIndexPath, formatBranchIndex('main', name), 'utf-8');
      }

      currentTrunk = name;
      currentBranch = 'main';

      if (piSessionFile) {
        setTrunkForSession(piSessionFile, name, 'main');
      }

      return { content: [{ type: "text", text: "Created trunk: [[" + name + "]] with main branch" }] };
    }
  });

  pi.registerCommand("ct branch", {
    description: "Create new branch",
    handler: (args: string) => {
      const name = args.trim();
      if (!name) {
        return { content: [{ type: "text", text: "Usage: `/ct branch <branch-name>`" }] };
      }
      if (!currentTrunk) {
        return { content: [{ type: "text", text: "No current trunk. Use `/ct new <name>` first." }] };
      }

      ensureDir(getBranchPath(currentTrunk, name));
      
      const branchIndexPath = path.join(getBranchPath(currentTrunk, name), 'branch-index.md');
      if (!fs.existsSync(branchIndexPath)) {
        fs.writeFileSync(branchIndexPath, formatBranchIndex(name, currentTrunk), 'utf-8');
      }

      currentBranch = name;

      if (piSessionFile) {
        setTrunkForSession(piSessionFile, currentTrunk, name);
      }

      return { content: [{ type: "text", text: "Created branch: [[" + currentTrunk + "/" + name + "]]" }] };
    }
  });

  // ==================== Quality & Tagging Commands ====================

  pi.registerCommand("ct rate", {
    description: "Rate a turn",
    handler: (args: string) => {
      const parts = args.trim().split(/\s+/);
      if (parts.length < 2) {
        return { content: [{ type: "text", text: "Usage: `/ct rate <turn-id> <1-5>`\nExample: `/ct rate Turn-003 5`" }] };
      }

      const turnId = parts[0];
      const score = parseInt(parts[1]);
      
      if (isNaN(score) || score < 1 || score > 5) {
        return { content: [{ type: "text", text: "Score must be between 1 and 5" }] };
      }

      const turn = getTurnById(turnId);
      if (!turn) {
        return { content: [{ type: "text", text: "Turn not found: " + turnId }] };
      }

      if (updateTurnMetadata(turn, { success_score: score })) {
        return { content: [{ type: "text", text: "Rated [[" + turnId + "]]: " + "★".repeat(score) }] };
      }

      return { content: [{ type: "text", text: "Error rating turn" }] };
    }
  });

  pi.registerCommand("ct tag", {
    description: "Add tag to turn",
    handler: (args: string) => {
      const parts = args.trim().split(/\s+/);
      if (parts.length < 2) {
        return { content: [{ type: "text", text: "Usage: `/ct tag <turn-id> <tag>`\nExample: `/ct tag Turn-003 bug-fix`" }] };
      }

      const turnId = parts[0];
      const tag = parts[1].toLowerCase().trim();
      
      if (!tag) {
        return { content: [{ type: "text", text: "Tag cannot be empty" }] };
      }

      const turn = getTurnById(turnId);
      if (!turn) {
        return { content: [{ type: "text", text: "Turn not found: " + turnId }] };
      }

      const newTags = [...turn.tags];
      if (!newTags.includes(tag)) {
        newTags.push(tag);
        if (updateTurnMetadata(turn, { tags: newTags })) {
          return { content: [{ type: "text", text: "Tagged [[" + turnId + "]]: " + newTags.join(', ') }] };
        }
      }

      return { content: [{ type: "text", text: "Turn already has tag: " + tag }] };
    }
  });

  pi.registerCommand("ct untag", {
    description: "Remove tag from turn",
    handler: (args: string) => {
      const parts = args.trim().split(/\s+/);
      if (parts.length < 2) {
        return { content: [{ type: "text", text: "Usage: `/ct untag <turn-id> <tag>`" }] };
      }

      const turnId = parts[0];
      const tag = parts[1].toLowerCase().trim();

      const turn = getTurnById(turnId);
      if (!turn) {
        return { content: [{ type: "text", text: "Turn not found: " + turnId }] };
      }

      const newTags = turn.tags.filter(t => t !== tag);
      if (newTags.length < turn.tags.length) {
        if (updateTurnMetadata(turn, { tags: newTags })) {
          return { content: [{ type: "text", text: "Removed tag from [[" + turnId + "]]: " + newTags.join(', ') || "(none)" }] };
        }
      }

      return { content: [{ type: "text", text: "Turn doesn't have tag: " + tag }] };
    }
  });

  pi.registerCommand("ct tags", {
    description: "List all tags",
    handler: (args: string) => {
      const pattern = args.trim().toLowerCase();
      const allTurns = indexAllTurns();
      const tagCounts = new Map<string, number>();

      for (const turn of allTurns) {
        for (const tag of turn.tags) {
          if (!pattern || tag.toLowerCase().includes(pattern)) {
            tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
          }
        }
      }

      if (tagCounts.size === 0) {
        return { content: [{ type: "text", text: pattern ? "No tags matching: " + pattern : "No tags found yet." }] };
      }

      // Sort by count descending
      const sorted = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]);

      let output = "## Tags";
      if (pattern) output += " matching: " + pattern;
      output += "\n\n";
      for (const [tag, count] of sorted) {
        output += "- **" + tag + "** (" + count + " turns)\n";
      }

      return { content: [{ type: "text", text: output }] };
    }
  });


  // ==================== Ancestry Commands ====================

  pi.registerCommand("ct ancestors", {
    description: "Show turn ancestry",
    handler: (args: string) => {
      let turnId = args.trim();
      
      if (!turnId) {
        // Default to last turn in current context
        if (currentTrunk && currentBranch) {
          const turns = listTurns(currentTrunk, currentBranch);
          if (turns.length > 0) {
            turnId = turns[turns.length - 1].replace('.md', '');
          }
        }
      }

      if (!turnId) {
        return { content: [{ type: "text", text: "No turn specified and no current context." }] };
      }

      const match = turnId.match(/Turn-(\d{3})/);
      if (!match) {
        return { content: [{ type: "text", text: "Invalid turn ID format. Use: Turn-001" }] };
      }

      const turnNum = parseInt(match[1], 10);
      let output = "## Ancestry: [[" + turnId + "]]\n\n";

      // Find the trunk/branch for this turn
      const allTurns = indexAllTurns();
      const turn = allTurns.find(t => t.id === turnId);
      
      if (!turn) {
        return { content: [{ type: "text", text: "Turn not found: " + turnId }] };
      }

      const ancestors = getAncestors(turn.trunk, turn.branchName, turnNum);
      
      if (ancestors.length === 0) {
        output += "_No ancestors (this is the root turn)_\n";
      } else {
        output += "**" + ancestors.length + "** ancestors:\n\n";
        for (const ancestor of ancestors.reverse()) {
          const time = new Date(ancestor.timestamp).toLocaleDateString();
          const preview = ancestor.prompt.substring(0, 50).replace(/\n/g, ' ') + (ancestor.prompt.length > 50 ? '...' : '');
          output += "- [[" + ancestor.trunk + "/" + ancestor.id + "]] (" + time + ")\n  > " + preview + "\n";
        }
      }

      output += "\n---\n**" + turnId + "** (current)\n";

      return { content: [{ type: "text", text: output }] };
    }
  });

  pi.registerCommand("ct children", {
    description: "Show child turns",
    handler: (args: string) => {
      const turnId = args.trim();
      
      if (!turnId) {
        return { content: [{ type: "text", text: "Usage: `/ct children <turn-id>`\nExample: `/ct children Turn-003`" }] };
      }

      const match = turnId.match(/Turn-(\d{3})/);
      if (!match) {
        return { content: [{ type: "text", text: "Invalid turn ID format. Use: Turn-001" }] };
      }

      const turnNum = parseInt(match[1], 10);

      // Find the turn first
      const allTurns = indexAllTurns();
      const turn = allTurns.find(t => t.id === turnId);
      
      if (!turn) {
        return { content: [{ type: "text", text: "Turn not found: " + turnId }] };
      }

      const children = getChildren(turn.trunk, turn.branchName, turnNum);
      
      let output = "## Children of [[" + turnId + "]]\n\n";

      if (children.length === 0) {
        output += "_No child turns_\n";
      } else {
        for (const child of children) {
          const time = new Date(child.timestamp).toLocaleDateString();
          const preview = child.prompt.substring(0, 50).replace(/\n/g, ' ') + (child.prompt.length > 50 ? '...' : '');
          output += "- [[" + child.trunk + "/" + child.id + "]] (" + time + ")\n  > " + preview + "\n";
        }
      }

      return { content: [{ type: "text", text: output }] };
    }
  });

  // ==================== Node Commands ====================

  pi.registerCommand("ct node", {
    description: "Load node content",
    handler: (args: string) => {
      const nodeId = args.trim();
      if (!nodeId) {
        return { content: [{ type: "text", text: "Usage: `/ct node <turn-id>`\nExample: `/ct node Turn-001`" }] };
      }

      const turn = getTurnById(nodeId);
      if (!turn) {
        return { content: [{ type: "text", text: "Node not found: " + nodeId + "\n\nUse `/ct search` to find turns." }] };
      }

      let output = "## [[" + turn.trunk + "/" + turn.id + "]]\n\n";
      output += "**Branch**: [[" + turn.trunk + "/" + turn.branchName + "]]\n";
      output += "**Model**: " + turn.model + "\n";
      if (turn.success_score !== null) {
        output += "**Score**: " + "★".repeat(turn.success_score) + "\n";
      }
      if (turn.tags.length > 0) {
        output += "**Tags**: " + turn.tags.join(', ') + "\n";
      }
      output += "**Time**: " + new Date(turn.timestamp).toLocaleString() + "\n\n";
      output += "---\n\n## Prompt\n\n" + turn.prompt + "\n\n---\n\n## Response\n\n" + turn.response + "\n";

      return { content: [{ type: "text", text: output }] };
    }
  });

  // ==================== Session Commands ====================

  pi.registerCommand("ct sessions", {
    description: "List PI session mappings",
    handler: (args: string) => {
      const mapping = loadSessionMapping();
      const sessions = Object.keys(mapping);
      
      if (sessions.length === 0) {
        return { content: [{ type: "text", text: "No PI sessions mapped yet.\nStart a new PI session to create a mapping." }] };
      }

      let output = "## PI Session -> Chat-Tree Mappings\n\n";
      for (const sessionFile of sessions) {
        const entry = mapping[sessionFile];
        const sessionName = path.basename(sessionFile, path.extname(sessionFile));
        const lastAccess = new Date(entry.lastAccess).toLocaleDateString();
        const current = sessionFile === piSessionFile ? " <- current" : "";
        output += "- **" + sessionName + "**" + current + "\n";
        output += "  -> [[" + entry.trunkName + "/" + entry.branch + "]]\n";
        output += "  Last access: " + lastAccess + "\n";
      }

      return { content: [{ type: "text", text: output }] };
    }
  });

  // ==================== Save Commands ====================

  pi.registerCommand("ct save", {
    description: "Save pending exchange",
    handler: (args: string, ctx: any) => {
      if (!currentTrunk) {
        currentTrunk = piSessionId || "session-" + Date.now().toString(36);
        currentBranch = 'main';
        ensureDir(getBranchPath(currentTrunk, 'main'));
        fs.writeFileSync(path.join(getTrunkPath(currentTrunk), 'trunk.md'), formatTrunkMarkdown(currentTrunk, piSessionId), 'utf-8');
        
        if (piSessionFile) {
          setTrunkForSession(piSessionFile, currentTrunk, 'main');
        }
      }

      if (!pendingExchange) {
        return { content: [{ type: "text", text: "No pending exchange.\nContinue a conversation to capture an exchange, then use `/ct save`." }] };
      }

      const lastTurn = listTurns(currentTrunk, currentBranch).length;
      const parentTurn = lastTurn > 0 ? "Turn-" + String(lastTurn).padStart(3, '0') : null;

      const result = saveTurn(
        currentTrunk,
        currentBranch,
        pendingExchange.prompt,
        pendingExchange.response,
        pendingExchange.model,
        parentTurn,
        [],
        piSessionId,
        piSessionFile
      );

      if (result) {
        pendingExchange = null;
        return { content: [{ type: "text", text: "Saved: [[" + currentTrunk + "/" + result.turnId + "]]" }] };
      }

      return { content: [{ type: "text", text: "Error saving turn" }] };
    }
  });

  pi.registerCommand("fruit", {
    description: "Save a fruit to a turn",
    handler: (args: string) => {
      const parts = args.trim().split(/\s+/);
      if (parts.length < 3) {
        return { content: [{ type: "text", text: "Usage: `/fruit <turn-id> <filename> <content>`\nExample: `/fruit Turn-001 component.tsx const x = 1`" }] };
      }

      const [turnId, filename, ...contentParts] = parts;
      const content = contentParts.join(' ');

      const turn = getTurnById(turnId);
      if (!turn) {
        return { content: [{ type: "text", text: "Turn not found: " + turnId }] };
      }

      const match = turnId.match(/Turn-(\d{3})/);
      if (!match) {
        return { content: [{ type: "text", text: "Invalid turn ID" }] };
      }

      const turnNum = parseInt(match[1], 10);
      const result = saveFruit(turn.trunk, turn.branchName, turnNum, filename, content);

      if (result) {
        return { content: [{ type: "text", text: "Fruit saved: [[" + path.basename(result) + "]]" }] };
      }

      return { content: [{ type: "text", text: "Error saving fruit" }] };
    }
  });

  // ==================== Config Commands ====================

  pi.registerCommand("ct config", {
    description: "Configure Chat-Tree",
    handler: (args: string) => {
      const parts = args.trim().split(/\s+/);
      if (parts.length >= 2) {
        const key = parts[0];
        const value = parts.slice(1).join(' ');

        if (key === 'vault') {
          config.vaultPath = value;
          return { content: [{ type: "text", text: "Vault path: " + value }] };
        }
        if (key === 'autosave') {
          config.autoSave = value === 'on';
          return { content: [{ type: "text", text: "Auto-save: " + (config.autoSave ? "on" : "off") }] };
        }
        if (key === 'model') {
          config.defaultModel = value;
          return { content: [{ type: "text", text: "Default model: " + value }] };
        }
      }

      return { content: [{ type: "text", text: "## Config\n\n- vault: " + config.vaultPath + "\n- autosave: " + (config.autoSave ? "on" : "off") + "\n- model: " + config.defaultModel + "\n\nUsage:\n/ct config vault /path\n/ct config autosave on|off\n/ct config model claude" }] };
    }
  });

  // ==================== Event Handlers ====================

  pi.on("assistant_complete", (event: any, ctx: any) => {
    try {
      if (ctx && typeof ctx.getLastExchange === 'function') {
        const lastExchange = ctx.getLastExchange();
        if (lastExchange && lastExchange.userPrompt) {
          pendingExchange = {
            prompt: lastExchange.userPrompt || "",
            response: lastExchange.assistantResponse || "",
            model: lastExchange.model || config.defaultModel,
            tokens: lastExchange.tokens || 0,
            timestamp: new Date().toISOString()
          };
        }
      }
    } catch (e) {
      // Silently handle
    }
  });

  pi.on("user_message", (event: any, ctx: any) => {
    if (pendingExchange && config.autoSave) {
      if (currentTrunk) {
        ensureDir(getBranchPath(currentTrunk, currentBranch));
        
        const lastTurn = listTurns(currentTrunk, currentBranch).length;
        const parentTurn = lastTurn > 0 ? "Turn-" + String(lastTurn).padStart(3, '0') : null;
        saveTurn(
          currentTrunk,
          currentBranch,
          pendingExchange.prompt,
          pendingExchange.response,
          pendingExchange.model,
          parentTurn,
          [],
          piSessionId,
          piSessionFile
        );
        console.log("[Chat-Tree] Auto-saved to " + currentTrunk);
        pendingExchange = null;
      }
    }
  });

  console.log("[Chat-Tree] v2.0 loaded! Session: " + (piSessionId || "none"));
}
