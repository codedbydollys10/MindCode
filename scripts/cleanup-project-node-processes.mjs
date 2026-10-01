import { execFileSync } from 'node:child_process';

const cleanUpProjectProcesses = () => {
  if (process.platform !== 'win32') {
    return;
  }

  const output = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'MindCode' -and ($_.CommandLine -match 'vite' -or $_.CommandLine -match 'server.js') } | Select-Object -ExpandProperty ProcessId",
    ],
    { encoding: 'utf8' }
  );

  const pids = output
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((value) => Number.isInteger(value) && value > 0)
    .filter((value, index, array) => array.indexOf(value) === index);

  for (const pid of pids) {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/F'], { stdio: 'ignore' });
      console.log(`[cleanup] stopped stale project process ${pid}`);
    } catch (error) {
      // Ignore already-dead processes.
    }
  }
};

cleanUpProjectProcesses();
