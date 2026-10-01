import net from 'node:net';
import { spawnSync } from 'node:child_process';

const port = Number(process.argv[2] ?? 8080);

const isPortOpen = () => new Promise((resolve) => {
  const socket = net.createConnection({ port, host: '127.0.0.1' });

  socket.once('connect', () => {
    socket.destroy();
    resolve(true);
  });

  socket.once('error', () => {
    resolve(false);
  });
});

const getListeningPids = () => {
  if (process.platform !== 'win32') {
    return [];
  }

  const result = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Listen' } | Select-Object -ExpandProperty OwningProcess -Unique`,
    ],
    { encoding: 'utf8' }
  );

  if (result.status !== 0 || !result.stdout) {
    return [];
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
};

const ensurePortFree = async () => {
  for (let i = 0; i < 10; i += 1) {
    if (!(await isPortOpen())) {
      return;
    }

    const pids = [...new Set(getListeningPids())];

    for (const pid of pids) {
      spawnSync('taskkill', ['/PID', String(pid), '/F'], { stdio: 'ignore' });
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Port ${port} is still occupied after cleanup.`);
};

ensurePortFree()
  .then(() => {
    console.log(`[port-check] Port ${port} is free.`);
  })
  .catch((error) => {
    console.error(`[port-check] ${error.message}`);
    process.exit(1);
  });
