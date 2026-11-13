import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Run every required check, even if the full audit reports known dev findings.
// Keep the final exit status non-zero for ANY failure; nothing is suppressed.
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run verification through npm run verify');
const results = [];
const commands = [
  ['dependency-tree', ['ls', '--all', '--json']],
  ['typecheck', ['run', 'typecheck']],
  ['lint', ['run', 'lint']],
  ['unit-and-local-sql-tests', ['test']],
  ['production-build', ['run', 'build']],
  ['dependency-audit', ['audit', '--json']],
  ['production-dependency-audit', ['audit', '--omit=dev', '--json']],
  ['secret-scan', ['run', 'check:secrets']],
  ['route-api-browser-smoke', ['run', 'test:smoke']],
];
for (const [name, args] of commands) {
  console.log(`\nRunning ${name}`);
  const startedAt = Date.now();
  const audit = name.includes('audit');
  const capture = audit || name === 'dependency-tree';
  let output = '';
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [npmCli, ...args], { windowsHide: true, env: process.env, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
    if (capture) child.stdout.on('data', (data) => { output += data; });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
  let auditMetadata;
  if (capture) {
    const report = JSON.parse(output);
    await mkdir('reports/phase1', { recursive: true });
    await writeFile(`reports/phase1/${name}.json`, JSON.stringify(report, null, 2) + '\n');
    auditMetadata = report.metadata;
    console.log(JSON.stringify(auditMetadata || report.error || { dependencyTreeExitCode: exitCode }));
  }
  results.push({ name, exitCode, durationMs: Date.now() - startedAt, ...(auditMetadata ? { auditMetadata } : {}) });
}
await mkdir(fileURLToPath(new URL('../reports/phase1/', import.meta.url)), { recursive: true });
await writeFile('reports/phase1/validation.json', JSON.stringify({ node: process.version, results }, null, 2) + '\n');
process.exitCode = results.some((result) => result.exitCode !== 0) ? 1 : 0;
