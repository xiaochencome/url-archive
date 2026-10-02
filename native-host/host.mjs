#!/usr/bin/env node
/**
 * CC Archive 的 Native Messaging host。
 *
 * 作用：让扩展能执行本地命令（启动本机服务、打开 Obsidian 等）。
 * 浏览器扩展本身不能执行 shell，必须经由这种本机进程。
 *
 * 协议：stdin/stdout 上跑 4 字节小端长度前缀 + JSON。
 */
import { spawn } from 'node:child_process';

const BLOCKED = [
  /rm\s+-rf\s+[~/]/i,
  /\bsudo\s+rm\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=.*of=\/dev\//i,
  /\bshutdown\b|\breboot\b/i,
  />\s*\/dev\/(disk|sd|nvme)/i,
];

function isAllowed(command) {
  const c = String(command || '').trim();
  if (!c || c.length > 500) return false;
  return !BLOCKED.some((re) => re.test(c));
}

function send(obj) {
  const json = Buffer.from(JSON.stringify(obj), 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(json.length, 0);
  process.stdout.write(Buffer.concat([len, json]));
}

function handle(msg) {
  if (msg?.type === 'ping') {
    return { ok: true, pong: true, platform: process.platform };
  }
  if (msg?.type === 'run') {
    const command = String(msg.command || '');
    if (!isAllowed(command)) {
      return { ok: false, error: '命令为空、过长或命中危险模式拦截' };
    }
    try {
      // 用登录 shell 执行，保证 PATH 与用户终端一致（能找到 brew 等 装的东西）
      const shell = process.env.SHELL || '/bin/zsh';
      const child = spawn(shell, ['-lc', command], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      return { ok: true, pid: child.pid, command };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return { ok: false, error: `未知请求类型：${String(msg?.type)}` };
}

let buf = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= 4) {
    const len = buf.readUInt32LE(0);
    if (buf.length < 4 + len) break;
    const body = buf.subarray(4, 4 + len).toString('utf8');
    buf = buf.subarray(4 + len);
    let msg;
    try { msg = JSON.parse(body); } catch { send({ ok: false, error: 'JSON 解析失败' }); continue; }
    send(handle(msg));
  }
});
process.stdin.on('end', () => process.exit(0));
