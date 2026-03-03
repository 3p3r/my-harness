# my-harness

My personal stack of AI tools for my own consumption!

## Global Dependencies

Install these packages globally:

```bash
# AI coding agent
curl -fsSL https://opencode.ai/install | bash

# Browser automation (Vercel)
npm install -g agent-browser
agent-browser install  # Download Chromium

# LSP
npm install -g typescript-language-server
```

## Installation

```bash
npm install
```

**Requirements:** Node.js 20+, npm 9+

## Usage

```bash
npm start
```

This starts a local Qwen3.5-35B model server on port 9090 (2x RTX 3090).

## Components

| Package | Purpose |
|---------|---------|
| **opencode** | Terminal AI coding agent (60K+ GitHub stars) |
| **oh-my-opencode** | Multi-agent orchestration plugin |
| **agent-browser** | Headless browser automation (16K+ stars) |
| **typescript-language-server** | TypeScript LSP server |
| **contextplus** | MCP for codebase navigation |
| **zx** | TypeScript shell scripting |
| **tsx** | TypeScript execution runtime |
| **@biomejs/biome** | Fast formatter/linter |

## Architecture

- **Models**: All agents route to local Qwen3.5-35B-A3B via llama-server
- **Browser Engine**: `agent-browser` (Vercel's Rust CLI)
- **LSP**: `typescript-language-server` for TypeScript/JavaScript
- **MCP**: `contextplus` for semantic code navigation

## Notes

- Windows: llama-server uses `llama-server.exe` (see `run.zx.ts`)
- Linux/macOS: Adjust command for your platform
- Model runs on `http://192.168.1.65:9090` (2x3090 GPU split)