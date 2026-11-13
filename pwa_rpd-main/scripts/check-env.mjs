import nextEnv from '@next/env';

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const required = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing ${key}; use .env.example for the retained CMS`);
}
const project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
if (project.protocol !== 'https:' || !project.hostname.endsWith('.supabase.co') || project.username || project.password || project.port || project.search || project.hash || !['', '/'].includes(project.pathname)) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL must be a plain HTTPS Supabase project origin');
}
for (const [name, value] of Object.entries(process.env)) {
  if (!name.startsWith('NEXT_PUBLIC_') || !value) continue;
  let privileged = /SERVICE_ROLE|SECRET|PRIVATE_KEY|PASSWORD/.test(name) || value.startsWith('sb_secret_');
  try { privileged ||= JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString()).role === 'service_role'; } catch { /* not a JWT */ }
  if (privileged) throw new Error(`Privileged configuration must not be public: ${name}`);
}
console.log('Public CMS configuration validated; no administrator credential is required.');
