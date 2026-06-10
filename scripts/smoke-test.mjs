/**
 * Smoke test — syntax + structure checks run in CI before every deploy.
 * Validates: server.js, db.js, and that required env vars are documented.
 * Does NOT start the server (that's what the post-deploy health check is for).
 *
 * Exit: 0 = pass, 1 = fail
 */

import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

let failed = false;
const fail = (msg) => { console.error('  ✗', msg); failed = true; };
const pass = (msg) => console.log('  ✓', msg);

console.log('\n🔍 Smoke checks\n');

// 1. Syntax check all server-side JS
const jsFiles = ['server.js', 'db.js'];
for (const f of jsFiles) {
  try {
    execSync(`node --check ${f}`, { stdio: 'pipe' });
    pass(`Syntax OK: ${f}`);
  } catch (e) {
    fail(`Syntax error in ${f}: ${e.stderr?.toString().trim()}`);
  }
}

// 2. package.json has "start" script and correct "type"
try {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  if (pkg.scripts?.start) pass('package.json has "start" script');
  else fail('package.json missing "start" script — Azure needs it');
  if (pkg.type === 'module') pass('package.json type=module');
  if (pkg.engines?.node) pass(`Engines pinned: node ${pkg.engines.node}`);
  else fail('No engines.node in package.json — pin Node version for Azure');
} catch (e) { fail('Cannot read package.json: ' + e.message); }

// 3. .env.example exists (documents required secrets)
if (existsSync('.env.example')) pass('.env.example present');
else fail('.env.example missing — new devs won\'t know what env vars to set');

// 4. Required env var SESSION_SECRET documented in .env.example or server.js
const serverSrc = readFileSync('server.js', 'utf8');
if (serverSrc.includes('SESSION_SECRET')) pass('SESSION_SECRET referenced in server.js');
else fail('SESSION_SECRET not found in server.js');

// 5. /healthz endpoint present
if (serverSrc.includes('/healthz')) pass('/healthz endpoint present');
else fail('/healthz missing — post-deploy health check will fail');

// 6. requireAuth is defined (even if pass-through)
if (serverSrc.includes('requireAuth')) pass('requireAuth middleware present');
else fail('requireAuth missing — admin routes unprotected');

// 7. No obvious secrets committed
const suspicious = ['sk-', 'AKIA', 'ghp_', 'BEGIN RSA', 'BEGIN EC'];
let secretFound = false;
for (const pat of suspicious) {
  if (serverSrc.includes(pat)) { fail(`Possible secret in server.js: "${pat}"`); secretFound = true; }
}
if (!secretFound) pass('No hardcoded secret patterns detected in server.js');

console.log(failed ? '\n❌ Smoke checks FAILED\n' : '\n✅ All checks passed\n');
process.exit(failed ? 1 : 0);
