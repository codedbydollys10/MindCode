import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const backendDir = path.join(rootDir, 'backend');
const frontendDir = path.join(rootDir, 'frontend');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmCliCandidates = [
  process.env.npm_execpath,
  path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  '/usr/local/lib/node_modules/npm/bin/npm-cli.js',
].filter(Boolean);
const npmCli = npmCliCandidates.find((candidate) => fs.existsSync(candidate));
const npmRunner = npmCli ? process.execPath : npmCmd;
const viteBin = process.platform === 'win32'
  ? path.join(frontendDir, 'node_modules', '.bin', 'vite.cmd')
  : path.join(frontendDir, 'node_modules', '.bin', 'vite');
const npmArgs = (args) => (npmCli ? [npmCli, ...args] : args);

const isPortOpen = (port) => new Promise((resolve) => {
  const socket = net.createConnection({ port, host: '127.0.0.1' });
  socket.once('connect', () => {
    socket.end();
    resolve(true);
  });
  socket.once('error', () => resolve(false));
});

const spawnProcess = (cwd, args, label) => {
  const child = spawn(npmRunner, npmArgs(args), {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });

  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`[${label}] exited with code ${code}`);
    }
  });

  return child;
};

const cleanup = (children) => {
  for (const child of children) {
    if (child && !child.killed) {
      child.kill('SIGINT');
    }
  }
};

const children = [];

if (!fs.existsSync(viteBin)) {
  console.log('[dev] Frontend dependencies missing; running npm install in frontend.');
  const install = spawnSync(npmRunner, npmArgs(['install', '--include=dev']), {
    cwd: frontendDir,
    stdio: 'inherit',
    env: process.env,
  });

  if (install.status !== 0) {
    process.exit(install.status ?? 1);
  }
}

if (await isPortOpen(3001)) {
  console.log('[dev] Backend already running on port 3001; skipping backend start.');
} else {
  console.log('[dev] Starting backend on port 3001.');
  children.push(spawnProcess(backendDir, ['run', 'dev'], 'backend'));
}

console.log('[dev] Starting frontend on port 8080.');
const frontend = spawnProcess(
  frontendDir,
  ['run', 'dev', '--', '--host', 'localhost', '--port', '8080', '--strictPort'],
  'frontend',
);
children.push(frontend);

const shutdown = () => cleanup(children);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

frontend.on('exit', (code) => {
  shutdown();
  process.exit(code ?? 0);
});
