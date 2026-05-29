/**
 * agentguard server — IPC/TCP server for persistent lock management
 *
 * Runs as a background daemon that agents connect to.
 * Uses newline-delimited JSON protocol over TCP.
 */

import * as net from "net";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { LockManager } from "./lock-manager.js";

const SOCKET_PATH = path.join(os.tmpdir(), "agentguard.sock");

interface Request {
  id?: number;
  cmd: string;
  file?: string;
  agent?: string;
  reason?: string;
  pid?: number;
  timeout?: number;
}

export function createServer(manager: LockManager, port: number = 0): net.Server {
  const server = net.createServer((socket) => {
    let buffer = "";

    socket.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const req: Request = JSON.parse(line);
          const response = handleRequest(manager, req);
          socket.write(JSON.stringify(response) + "\n");
        } catch {
          socket.write(JSON.stringify({ error: "invalid JSON" }) + "\n");
        }
      }
    });

    socket.on("error", () => {
      // Client disconnected, ignore
    });
  });

  if (port > 0) {
    server.listen(port, () => {
      console.log(`agentguard server listening on port ${port}`);
    });
  } else {
    // Clean up stale socket
    try {
      fs.unlinkSync(SOCKET_PATH);
    } catch {
      // Doesn't exist, fine
    }

    server.listen(SOCKET_PATH, () => {
      console.log(`agentguard server listening on ${SOCKET_PATH}`);
    });

    process.on("SIGINT", () => {
      manager.shutdown();
      server.close();
      try {
        fs.unlinkSync(SOCKET_PATH);
      } catch {}
      process.exit(0);
    });

    process.on("SIGTERM", () => {
      manager.shutdown();
      server.close();
      try {
        fs.unlinkSync(SOCKET_PATH);
      } catch {}
      process.exit(0);
    });
  }

  return server;
}

function handleRequest(manager: LockManager, req: Request): object {
  const { cmd } = req;

  switch (cmd) {
    case "lock": {
      if (!req.file || !req.agent) {
        return { error: "file and agent required" };
      }
      const result = manager.acquire(req.file, req.agent, {
        reason: req.reason,
        pid: req.pid,
        timeout: req.timeout,
      });
      if (result.ok) {
        return { ok: true, lock: serializeLock(result.lock) };
      }
      return { ok: false, conflict: serializeLock(result.conflict) };
    }

    case "unlock": {
      if (!req.file || !req.agent) {
        return { error: "file and agent required" };
      }
      const result = manager.release(req.file, req.agent);
      if (result.ok) return { ok: true };
      return { ok: false, error: result.error };
    }

    case "force-unlock": {
      if (!req.file) return { error: "file required" };
      const result = manager.forceRelease(req.file);
      if (result.ok) return { ok: true, released: serializeLock(result.released) };
      return { ok: false, error: result.error };
    }

    case "status": {
      const locks = manager.getAllLocks();
      return { locks: locks.map(serializeLock) };
    }

    case "list": {
      if (!req.agent) return { error: "agent required" };
      const locks = manager.getLocksByAgent(req.agent);
      return { locks: locks.map(serializeLock) };
    }

    case "clean": {
      const cleaned = manager.cleanExpired();
      return { cleaned };
    }

    case "release-agent": {
      if (!req.agent) return { error: "agent required" };
      const count = manager.releaseAllByAgent(req.agent);
      return { ok: true, released: count };
    }

    default:
      return { error: `unknown command: ${cmd}` };
  }
}

function serializeLock(lock: { filePath: string; agent: string; reason?: string; acquiredAt: number; pid?: number; timeout?: number }) {
  return {
    file: lock.filePath,
    agent: lock.agent,
    reason: lock.reason ?? null,
    acquiredAt: new Date(lock.acquiredAt).toISOString(),
    pid: lock.pid ?? null,
    timeout: lock.timeout ?? null,
  };
}
