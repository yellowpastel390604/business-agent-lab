// Tiny .env loader for dev scripts (reads provenance/.env; never printed).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function loadEnv() {
  const env = { ...process.env };
  try {
    const file = readFileSync(fileURLToPath(new URL('../.env', import.meta.url)), 'utf8');
    for (const line of file.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && m[2] && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* no .env file */ }
  return env;
}
