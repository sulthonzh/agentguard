import { describe, it, expect, beforeEach } from "vitest";
import { LockManager } from "./lock-manager.js";

describe("LockManager", () => {
  let lm: LockManager;

  beforeEach(() => {
    lm = new LockManager({ defaultTimeout: 5000 });
  });

  it("acquires a lock", () => {
    const result = lm.acquire("src/auth.ts", "claude-code", {
      reason: "refactoring auth",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lock.filePath).toBe("src/auth.ts");
      expect(result.lock.agent).toBe("claude-code");
      expect(result.lock.reason).toBe("refactoring auth");
    }
  });

  it("blocks conflicting locks", () => {
    lm.acquire("src/auth.ts", "claude-code");
    const result = lm.acquire("src/auth.ts", "cursor", {
      reason: "fixing imports",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.conflict.agent).toBe("claude-code");
    }
  });

  it("allows same agent to re-acquire (refresh)", () => {
    lm.acquire("src/auth.ts", "claude-code", { reason: "first" });
    const result = lm.acquire("src/auth.ts", "claude-code", {
      reason: "second",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lock.reason).toBe("second");
    }
  });

  it("releases a lock", () => {
    lm.acquire("src/auth.ts", "claude-code");
    const result = lm.release("src/auth.ts", "claude-code");
    expect(result.ok).toBe(true);
    expect(lm.isLocked("src/auth.ts")).toBe(false);
  });

  it("only owner can release", () => {
    lm.acquire("src/auth.ts", "claude-code");
    const result = lm.release("src/auth.ts", "cursor");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("claude-code");
    }
  });

  it("force-releases any lock", () => {
    lm.acquire("src/auth.ts", "claude-code");
    const result = lm.forceRelease("src/auth.ts");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.released.agent).toBe("claude-code");
    }
  });

  it("lists all locks", () => {
    lm.acquire("src/a.ts", "claude-code");
    lm.acquire("src/b.ts", "cursor");
    const locks = lm.getAllLocks();
    expect(locks).toHaveLength(2);
  });

  it("lists locks by agent", () => {
    lm.acquire("src/a.ts", "claude-code");
    lm.acquire("src/b.ts", "cursor");
    lm.acquire("src/c.ts", "claude-code");
    const locks = lm.getLocksByAgent("claude-code");
    expect(locks).toHaveLength(2);
  });

  it("releases all locks by agent", () => {
    lm.acquire("src/a.ts", "claude-code");
    lm.acquire("src/b.ts", "cursor");
    lm.acquire("src/c.ts", "claude-code");
    const count = lm.releaseAllByAgent("claude-code");
    expect(count).toBe(2);
    expect(lm.getAllLocks()).toHaveLength(1);
  });

  it("normalizes file paths", () => {
    lm.acquire("src/auth.ts", "claude-code");
    expect(lm.isLocked("src/auth.ts")).toBe(true);
    expect(lm.isLocked("src\\auth.ts")).toBe(true);
  });

  it("auto-releases after timeout", async () => {
    lm.acquire("src/auth.ts", "claude-code", { timeout: 50 });
    expect(lm.isLocked("src/auth.ts")).toBe(true);
    await new Promise((r) => setTimeout(r, 80));
    expect(lm.isLocked("src/auth.ts")).toBe(false);
  });

  it("cleans expired locks", () => {
    // Manually inject an expired lock
    lm["locks"].set("src/old.ts", {
      filePath: "src/old.ts",
      agent: "ghost",
      acquiredAt: Date.now() - 60000,
      timeout: 1000,
    });
    const cleaned = lm.cleanExpired();
    expect(cleaned).toBe(1);
  });

  it("getLock returns undefined for unlocked file", () => {
    expect(lm.getLock("nonexistent.ts")).toBeUndefined();
  });

  it("release fails for unlocked file", () => {
    const result = lm.release("nonexistent.ts", "agent");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("not locked");
    }
  });

  it("forceRelease fails for unlocked file", () => {
    const result = lm.forceRelease("nonexistent.ts");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("not locked");
    }
  });

  it("shutdown clears everything", () => {
    lm.acquire("src/a.ts", "claude-code");
    lm.acquire("src/b.ts", "cursor");
    lm.shutdown();
    expect(lm.getAllLocks()).toHaveLength(0);
  });
});
