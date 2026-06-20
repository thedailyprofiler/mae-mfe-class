/**
 * Run the SQLite storage backend and the Vite dev server together.
 * Zero dependencies — just spawns both and forwards their output.
 *
 *   npm run dev:full
 */
import { spawn } from 'node:child_process';

const procs = [
  { name: 'api', color: '\x1b[32m', cmd: 'node', args: ['--disable-warning=ExperimentalWarning', 'server/index.mjs'] },
  { name: 'web', color: '\x1b[36m', cmd: 'npx', args: ['vite'] },
];

const children = procs.map(({ name, color, cmd, args }) => {
  const child = spawn(cmd, args, { stdio: ['inherit', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  const tag = `${color}[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    stream.on('data', (buf) => {
      for (const line of buf.toString().split('\n')) {
        if (line.length) out.write(tag + line + '\n');
      }
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`${tag}exited (${code}) — shutting down`);
    shutdown();
  });
  return child;
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try { c.kill('SIGTERM'); } catch { /* already gone */ }
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
