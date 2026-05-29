/**
 * agentguard — core lock manager
 *
 * A lightweight in-process file lock registry for coordinating
 * multiple AI coding agents editing the same project.
 */

export interface Lock {
  filePath: string;
  agent: string;
  reason?: string;
  acquiredAt: number; // epoch ms
  pid?: number;
  timeout?: number; // ms, auto-release after this
}

export interface LockManagerOptions {
  defaultTimeout?: number; // ms, default auto-release timeout
}

export class LockManager {
  private locks = new Map<string, Lock>();
  private defaultTimeout: number;
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(options: LockManagerOptions = {}) {
    this.defaultTimeout = options.defaultTimeout ?? 30 * 60 * 1000; // 30 min
  }

  /**
   * Acquire a lock on a file for an agent.
   * Returns the lock if successful, or the existing lock if held by someone else.
   */
  acquire(
    filePath: string,
    agent: string,
    opts?: { reason?: string; pid?: number; timeout?: number }
  ): { ok: true; lock: Lock } | { ok: false; conflict: Lock } {
    const normalized = this.normalize(filePath);
    const existing = this.locks.get(normalized);

    if (existing) {
      // Same agent can re-acquire (refresh)
      if (existing.agent === agent) {
        this.clearTimer(normalized);
        const timeout = opts?.timeout ?? this.defaultTimeout;
        const lock: Lock = {
          filePath: normalized,
          agent,
          reason: opts?.reason ?? existing.reason,
          acquiredAt: Date.now(),
          pid: opts?.pid ?? existing.pid,
          timeout,
        };
        this.locks.set(normalized, lock);
        this.setAutoRelease(normalized, timeout);
        return { ok: true, lock };
      }
      return { ok: false, conflict: existing };
    }

    const timeout = opts?.timeout ?? this.defaultTimeout;
    const lock: Lock = {
      filePath: normalized,
      agent,
      reason: opts?.reason,
      acquiredAt: Date.now(),
      pid: opts?.pid,
      timeout,
    };
    this.locks.set(normalized, lock);
    this.setAutoRelease(normalized, timeout);
    return { ok: true, lock };
  }

  /**
   * Release a lock. Only the owning agent (or force) can release.
   */
  release(filePath: string, agent: string): { ok: true } | { ok: false; error: string } {
    const normalized = this.normalize(filePath);
    const existing = this.locks.get(normalized);

    if (!existing) {
      return { ok: false, error: "not locked" };
    }
    if (existing.agent !== agent) {
      return { ok: false, error: `locked by ${existing.agent}` };
    }

    this.clearTimer(normalized);
    this.locks.delete(normalized);
    return { ok: true };
  }

  /**
   * Force-release a lock regardless of agent.
   */
  forceRelease(filePath: string): { ok: true; released: Lock } | { ok: false; error: string } {
    const normalized = this.normalize(filePath);
    const existing = this.locks.get(normalized);

    if (!existing) {
      return { ok: false, error: "not locked" };
    }

    this.clearTimer(normalized);
    this.locks.delete(normalized);
    return { ok: true, released: existing };
  }

  /**
   * Get the lock for a file, if any.
   */
  getLock(filePath: string): Lock | undefined {
    return this.locks.get(this.normalize(filePath));
  }

  /**
   * Get all current locks.
   */
  getAllLocks(): Lock[] {
    return Array.from(this.locks.values());
  }

  /**
   * Get all locks held by a specific agent.
   */
  getLocksByAgent(agent: string): Lock[] {
    return this.getAllLocks().filter((l) => l.agent === agent);
  }

  /**
   * Release all locks held by an agent.
   */
  releaseAllByAgent(agent: string): number {
    const agentLocks = this.getLocksByAgent(agent);
    for (const lock of agentLocks) {
      this.clearTimer(lock.filePath);
      this.locks.delete(lock.filePath);
    }
    return agentLocks.length;
  }

  /**
   * Check if a file is locked.
   */
  isLocked(filePath: string): boolean {
    return this.locks.has(this.normalize(filePath));
  }

  /**
   * Clean up expired locks (shouldn't be needed with timers, but safety net).
   */
  cleanExpired(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [path, lock] of this.locks) {
      if (lock.timeout && now - lock.acquiredAt > lock.timeout) {
        this.clearTimer(path);
        this.locks.delete(path);
        cleaned++;
      }
    }
    return cleaned;
  }

  /**
   * Graceful shutdown — release all locks.
   */
  shutdown(): void {
    for (const key of this.timers.keys()) {
      this.clearTimer(key);
    }
    this.locks.clear();
  }

  private normalize(filePath: string): string {
    // Normalize to forward slashes and remove trailing slashes
    return filePath.replace(/\\/g, "/").replace(/\/+$/, "");
  }

  private setAutoRelease(normalized: string, timeout: number): void {
    const timer = setTimeout(() => {
      this.locks.delete(normalized);
      this.timers.delete(normalized);
    }, timeout);
    timer.unref?.(); // Don't keep process alive for timers
    this.timers.set(normalized, timer);
  }

  private clearTimer(normalized: string): void {
    const timer = this.timers.get(normalized);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(normalized);
    }
  }
}

// Singleton for CLI usage
let _instance: LockManager | undefined;

export function getLockManager(options?: LockManagerOptions): LockManager {
  if (!_instance) {
    _instance = new LockManager(options);
  }
  return _instance;
}
