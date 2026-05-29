#!/usr/bin/env node
/**
 * agentguard CLI — coordinate AI coding agents
 *
 * Usage:
 *   agentguard lock <file> --agent <name> [--reason "..."] [--timeout 60000]
 *   agentguard unlock <file> --agent <name>
 *   agentguard force-unlock <file>
 *   agentguard status [--json]
 *   agentguard list <agent>
 *   agentguard clean
 */

import { Command } from "commander";
import { LockManager } from "./lock-manager.js";
import { formatStatus, formatLock, formatLockJson } from "./format.js";
import chalk from "chalk";
import { createServer } from "./server.js";
import { VERSION } from "./version.js";

const program = new Command();

// Shared lock manager — in CLI mode this is per-invocation,
// in server mode it persists across connections.
const manager = new LockManager();

program
  .name("agentguard")
  .description("File-level locks for AI coding agents")
  .version(VERSION);

program
  .command("lock")
  .description("Acquire a lock on a file")
  .argument("<file>", "File path to lock")
  .requiredOption("-a, --agent <name>", "Agent name acquiring the lock")
  .option("-r, --reason <text>", "Reason for locking")
  .option("-t, --timeout <ms>", "Auto-release timeout in ms", "1800000")
  .option("--pid <pid>", "Process ID of the agent")
  .action((file, opts) => {
    const result = manager.acquire(file, opts.agent, {
      reason: opts.reason,
      pid: opts.pid ? parseInt(opts.pid, 10) : undefined,
      timeout: parseInt(opts.timeout, 10),
    });

    if (result.ok) {
      console.log(chalk.green("🔒 Locked:"), formatLock(result.lock));
    } else {
      console.error(
        chalk.red("❌ Conflict:"),
        `${file} is locked by ${chalk.bold(result.conflict.agent)}` +
          (result.conflict.reason ? ` (${result.conflict.reason})` : "")
      );
      console.error(
        chalk.gray(`   Locked ${formatTimeAgo(result.conflict.acquiredAt)}`)
      );
      process.exit(1);
    }
  });

program
  .command("unlock")
  .description("Release a lock on a file")
  .argument("<file>", "File path to unlock")
  .requiredOption("-a, --agent <name>", "Agent name releasing the lock")
  .action((file, opts) => {
    const result = manager.release(file, opts.agent);
    if (result.ok) {
      console.log(chalk.green("🔓 Unlocked:"), file);
    } else {
      console.error(chalk.red("❌ Cannot unlock:"), result.error);
      process.exit(1);
    }
  });

program
  .command("force-unlock")
  .description("Force-release a lock regardless of agent")
  .argument("<file>", "File path to force-unlock")
  .action((file) => {
    const result = manager.forceRelease(file);
    if (result.ok) {
      console.log(
        chalk.yellow("⚡ Force-unlocked:"),
        `${file} (was held by ${result.released.agent})`
      );
    } else {
      console.error(chalk.red("❌ Cannot unlock:"), result.error);
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Show all current locks")
  .option("--json", "Output as JSON")
  .action((opts) => {
    const locks = manager.getAllLocks();
    if (locks.length === 0) {
      console.log(chalk.gray("No active locks"));
      return;
    }
    if (opts.json) {
      console.log(JSON.stringify(locks, null, 2));
      return;
    }
    console.log(formatStatus(locks));
  });

program
  .command("list")
  .description("List all locks held by an agent")
  .argument("<agent>", "Agent name")
  .option("--json", "Output as JSON")
  .action((agent, opts) => {
    const locks = manager.getLocksByAgent(agent);
    if (locks.length === 0) {
      console.log(chalk.gray(`No locks held by ${agent}`));
      return;
    }
    if (opts.json) {
      console.log(JSON.stringify(locks, null, 2));
      return;
    }
    console.log(chalk.bold(`Locks held by ${agent}:`));
    for (const lock of locks) {
      console.log(`  ${formatLock(lock)}`);
    }
  });

program
  .command("clean")
  .description("Remove expired locks")
  .action(() => {
    const cleaned = manager.cleanExpired();
    console.log(chalk.green(`Cleaned ${cleaned} expired lock(s)`));
  });

program
  .command("serve")
  .description("Start the agentguard server (IPC)")
  .option("-p, --port <port>", "TCP port (default: IPC socket)", "0")
  .action((opts) => {
    const port = parseInt(opts.port, 10);
    createServer(manager, port);
  });

program.parse();

function formatTimeAgo(epoch: number): string {
  const diff = Date.now() - epoch;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}
