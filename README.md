# agentguard

File-level locks for AI coding agents running on the same machine.

## Why?

If you're running Claude Code in one terminal, Cursor in the IDE, and Copilot in VS Code — they're all editing the same project. Nobody coordinates file access. When two agents edit the same file at the same time, you get silent overwrites, broken code, and merge conflicts that agents can't resolve.

agentguard gives you a simple lock protocol so agents declare what they're editing and stay out of each other's way.

## Install

```bash
npm install -g agentguard
```

## Quick Start

```bash
# Lock a file before editing
agentguard lock src/auth.ts --agent claude-code --reason "refactoring auth module"

# Check what's locked
agentguard status

# Unlock when done
agentguard unlock src/auth.ts --agent claude-code

# Someone's stuck? Force unlock
agentguard force-unlock src/auth.ts
```

## Commands

### `lock <file> —agent <name> [options]`
Acquire a lock on a file.
- `-a, --agent <name>` — Agent name (required)
- `-r, --reason <text>` — Why you're locking it
- `-t, --timeout <ms>` — Auto-release timeout (default: 30 min)
- `--pid <pid>` — Agent's process ID

### `unlock <file> —agent <name>`
Release your lock. Only the owning agent can unlock.

### `force-unlock <file>`
Release any lock regardless of owner. Use when an agent crashed without cleaning up.

### `status [--json]`
Show all active locks. `--json` for machine-readable output.

### `list <agent> [--json]`
Show all locks held by a specific agent.

### `clean`
Remove any locks that have expired past their timeout.

### `serve [--port <port>]`
Start a persistent server (IPC socket or TCP port). Other processes connect via newline-delimited JSON.

## Server Protocol

Start the server:
```bash
agentguard serve
# or with a TCP port
agentguard serve --port 9876
```

Send commands as newline-delimited JSON:
```json
{"cmd":"lock","file":"src/auth.ts","agent":"claude-code","reason":"refactoring"}
{"cmd":"status"}
{"cmd":"unlock","file":"src/auth.ts","agent":"claude-code"}
```

Responses are also newline-delimited JSON:
```json
{"ok":true,"lock":{"file":"src/auth.ts","agent":"claude-code","reason":"refactoring","acquiredAt":"2026-05-30T04:00:00.000Z"}}
```

## Programmatic API

```typescript
import { LockManager } from "agentguard";

const manager = new LockManager({ defaultTimeout: 60000 });

// Acquire
const result = manager.acquire("src/auth.ts", "claude-code", {
  reason: "refactoring auth",
});

if (result.ok) {
  console.log("Lock acquired");
} else {
  console.log(`Blocked by ${result.conflict.agent}`);
}

// Release
manager.release("src/auth.ts", "claude-code");

// Check status
manager.getAllLocks();
manager.getLocksByAgent("claude-code");
```

## How It Works

1. **Lock Manager** — In-memory registry mapping file paths to agent locks
2. **Auto-release** — Every lock has a timeout (default 30 min). If the agent crashes, the lock auto-expires
3. **Same-agent refresh** — An agent can re-lock a file it already holds (refreshes timeout)
4. **Force unlock** — Emergency escape hatch for stuck locks
5. **Server mode** — Persistent daemon so multiple agent processes share one lock registry

## Use Cases

- **Multi-agent dev** — Claude Code + Cursor + Copilot in the same repo
- **CI guardrails** — Prevent concurrent deployments to the same files
- **Team coordination** — Shared dev server with multiple agents running
- **Agent harnesses** — ECC, OpenClaw, or custom orchestration tools

## License

MIT
