import chalk from "chalk";
import type { Lock } from "./lock-manager.js";

export function formatLock(lock: Lock): string {
  const age = formatTimeAgo(lock.acquiredAt);
  const parts = [
    chalk.cyan(lock.filePath),
    chalk.gray(`(${lock.agent})`),
  ];
  if (lock.reason) parts.push(chalk.italic(`— ${lock.reason}`));
  parts.push(chalk.gray(age));
  return parts.join(" ");
}

export function formatLockJson(lock: Lock): object {
  return {
    file: lock.filePath,
    agent: lock.agent,
    reason: lock.reason ?? null,
    acquiredAt: new Date(lock.acquiredAt).toISOString(),
    pid: lock.pid ?? null,
    timeout: lock.timeout ?? null,
  };
}

export function formatStatus(locks: Lock[]): string {
  const lines = [chalk.bold(`Active locks (${locks.length}):\n`)];
  for (const lock of locks) {
    lines.push(`  🔒 ${formatLock(lock)}`);
  }
  return lines.join("\n");
}

function formatTimeAgo(epoch: number): string {
  const diff = Date.now() - epoch;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}
