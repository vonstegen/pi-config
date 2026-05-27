# MacBook Pro M5 Max Setup Guide

**Machine:** 2026 MacBook Pro M5 Max  
**Specs:** 40-core GPU, 128GB unified memory  
**Target:** Full pi + VibeLLM + local models setup

---

## 1. Initial System Setup

```bash
# Check Apple Silicon
uname -m  # Should return "arm64"

# Install Homebrew (if not present)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Essential tools
brew install git node python@3.12  # python@3.12 for ARM64 optimzed PyTorch
brew install htop git-lfs curl wget
```

---

## 2. Install pi Coding Agent

```bash
# Install pi via npm
npm install -g @earendil-works/pi-coding-agent

# Verify installation
pi --version
```
git clone https://github.com/vonstegen/pi-config.git ~/Developer/pi-config
cd ~/Developer/pi-config

# Deploy with symlinks (keeps sessions/auth/logs intact)
./setup.sh --symlink
```

---

## 3. Install Extensions Dependencies

```bash
# pi-permissions
cd ~/.pi/agent/extensions/pi-permissions && npm install

# agentmemory (no extra deps needed)
# vibellm (needs vibellm project - see below)
# chat-tree, wiki-janitor (no deps)
```

---

## 4. Setup VibeLLM (Apple Silicon Optimized)

```bash
# Create vibellm project directory
mkdir -p ~/vibellm
cd ~/vibellm

# Install PyTorch with Metal GPU (MPS) support
pip3 install torch torchvision torchao --index-url https://download.pytorch.org/whl/cpu
# Note: Apple Silicon uses MPS, NOT CUDA. PyTorch MPS backend.

# Install VibeLLM dependencies
pip3 install \
    numpy \
    sentencepiece \
    transformers \
    peft \
    bitsandbytes \
    datasets \
    accelerate \
    trl \
    xformers \
    unsloth \
    qwen-tokenizer \
    jinja2

# Verify MPS availability
python3 -c "import torch; print('MPS:', torch.backends.mps.is_available()); print('Device:', torch.device('mps' if torch.backends.mps.is_available() else 'cpu'))"
```

> **Note on GPU:** M5 Max 40-core GPU uses Apple's Metal Performance Shaders (MPS). Unlike CUDA (NVIDIA), MPS is the Apple Silicon equivalent. PyTorch supports MPS for most operations. Unsloth has Apple Silicon support for faster fine-tuning.

---

## 5. Install Ollama (Apple Silicon Build)

```bash
# Install Ollama
brew install ollama

# Start Ollama service
brew services start ollama

# Pull models optimized for Apple Silicon
ollama pull qwen3:8b
ollama pull qwen3:14b
ollama pull qwen3:30b      # 128GB RAM can handle larger models
ollama pull gemma3:4b
ollama pull gemma3:12b     # 128GB RAM can handle
ollama pull gemma3:27b     # 128GB RAM can handle
ollama pull hermes3:8b
ollama pull llama3.3:70b    # 128GB RAM can handle

# Embedding model for RAG
ollama pull nomic-embed-text:latest

# Verify
ollama list
```

---

## 6. Configure OpenRouter API Key

```bash
# Create auth.json from template
cp ~/Developer/pi-config/auth.json.example ~/.pi/agent/auth.json

# Edit with your API key
nano ~/.pi/agent/auth.json
```

Template:
```json
{
  "openrouter": {
    "type": "api_key",
    "key": "sk-or-v1-YOUR-KEY-HERE"
  }
}
```

> Get key at: https://openrouter.ai/keys

---

## 7. Update VibeLLM Extension for Apple Silicon

The `vibellm.ts` extension is already portable (uses `$HOME` instead of hardcoded paths). 

**No manual editing needed** — the extension will automatically detect MPS on Apple Silicon.

To verify it's working after setup:
```bash
cd ~/Developer/pi-config
cat extensions/vibellm.ts | grep VIBELLM_ROOT
# Should show: const VIBELLM_ROOT = `${Deno.env.get("HOME")}/vibellm`;
```

The VibeLLM Python CLI (step 4) handles MPS detection internally when you run:
```bash
cd ~/vibellm && python3 -m training.cli check
```

---

## 8. Install Claude CLI / Claude Code (Optional)

For full pi ecosystem with Claude integration:

```bash
# Install Claude CLI
brew install anthropic

# Verify
claude --version
```

---

---

## 9. Validate Everything Works

```bash
# 1. Verify pi is installed
pi --version

# 2. Start pi (this loads extensions including vibellm, agentmemory, etc.)
pi

# 3. Inside pi, test these tools:
#    - vibellm_status      (should show MPS available)
#    - memory_health       (should return healthy)

# 4. Test Ollama is running
ollama list
curl http://localhost:11434/api/generate -d '{"model": "qwen3:8b", "prompt": "Hi", "stream": false}'

# 5. Test VibeLLM
cd ~/vibellm && python3 -m training.cli check
```

**If all tests pass → you're ready to use pi!** 🚀

---

## 10. Sync Workflows from Current Machine

Key files to sync:
- `~/.config/lazyvim/` → Neovim LazyVim config
- `~/.config/nvim/` → Any custom nvim configs
- `~/.pi/agent/auth.json` → API keys (ALREADY SYNCED via pi-config)
- `~/vibellm/` → VibeLLM training system

```bash
# From THIS machine (Dell XPS):
rsync -avz ~/.pi/agent/extensions/vibellm.ts andre@macbook:/home/andre/.pi/agent/extensions/

# Copy vibellm project
rsync -avz ~/vibellm/ andre@macbook:/home/andre/vibellm/

# Copy Neovim configs
rsync -avz ~/.config/lazyvim/ andre@macbook:/home/andre/.config/lazyvim/
```

---

## M5 Max Specific Advantages

| Task | M5 Max Benefit |
|------|---------------|
| Ollama inference | 40-core GPU runs local LLMs efficiently |
| VibeLLM training | 128GB unified memory fits large models |
| QLoRA fine-tuning | Unsloth + MPS = fast training |
| Multiple models | Load 2-3 models simultaneously |
|上下文 window | 128GB supports full 128K context |

---

## Quick Reference

```bash
# Daily startup
brew services start ollama

# Check models
ollama list

# Check VibeLLM status
cd ~/vibellm && python3 -m training.cli check

# Update pi-config
cd ~/Developer/pi-config && git pull && ./setup.sh --symlink
```

---

## Troubleshooting

**Ollama slow on Apple Silicon:**
```bash
# Use metal backend
OLLAMA_METAL=1 ollama serve
```

**VibeLLM training fails with MPS:**
```bash
# Fall back to CPU only (slower but works)
export PYTORCH_ENABLE_MPS_FALLBACK=1
```

**pip3 not finding ARM64 packages:**
```bash
# Ensure using ARM64 Python, not x86
which python3  # Should be /opt/homebrew/bin/python3
arch -arm64 python3 -m pip install ...
```