import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createHash } from 'node:crypto';
import path from 'node:path';

let local = {};
try { local = parseEnv(await readFile('.env.local', 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const privateValues = Object.entries({ ...local, ...process.env }).filter(([name, value]) =>
  !name.startsWith('NEXT_PUBLIC_') && /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY/.test(name) && value?.length >= 12
);
const findings = [];
let scanned = 0;
async function scan(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'cache') await scan(file); }
    else if (/\.(?:js|mjs|cjs|ts|tsx|json|html|map|sql|md|txt)$/.test(entry.name)) {
      const data = await readFile(file); scanned++;
      for (const [name, value] of privateValues) if (data.includes(Buffer.from(value))) findings.push({ file, credentialName: name });
    }
  }
}
for (const folder of ['src', '.next', 'scripts', 'tests', 'supabase', 'reports', '.orchids', 'public']) await scan(folder);
for (const entry of await readdir('.', { withFileTypes: true })) {
  if (!entry.isFile() || (!/\.(?:js|mjs|cjs|ts|json|md|txt)$/.test(entry.name) && entry.name !== '.env.example')) continue;
  const data = await readFile(entry.name); scanned++;
  for (const [name, value] of privateValues) if (data.includes(Buffer.from(value))) findings.push({ file: entry.name, credentialName: name });
}
let environmentUnchanged = null;
try {
  const baseline = JSON.parse(await readFile('reports/phase1/baseline.json', 'utf8'));
  const hash = createHash('sha256').update(await readFile('.env.local')).digest('hex');
  environmentUnchanged = hash === baseline.environmentSha256;
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir('reports/phase1', { recursive: true });
await writeFile('reports/phase1/secret-scan.json', JSON.stringify({ scannedFiles: scanned, suppliedPrivateCredentialsChecked: privateValues.length, findings, environmentUnchanged }, null, 2) + '\n');
assert.deepEqual(findings, [], 'A private credential was found in source/build output (values are never printed)');
assert.notEqual(environmentUnchanged, false, '.env.local changed during Phase 1');
console.log(`Secret scan passed: ${scanned} source/build files; local environment preserved.`);
