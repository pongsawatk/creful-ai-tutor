import { readFileSync } from 'node:fs';

const env = {};

for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!match) continue;

  let value = match[2].trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  env[match[1]] = value;
}

for (const key of ['NOTION_TOKEN', 'GITHUB_TOKEN', 'GITHUB_REPO']) {
  if (!env[key]) {
    throw new Error(`Missing ${key} in local .env`);
  }
}

const headers = {
  'Content-Type': 'application/json',
  'x-notion-token': env.NOTION_TOKEN,
  'x-github-token': env.GITHUB_TOKEN,
  'x-github-repo': env.GITHUB_REPO
};

if (env.NOTION_DATA_SOURCE_ID) {
  headers['x-notion-data-source-id'] = env.NOTION_DATA_SOURCE_ID;
}

const response = await fetch('https://ct-automation.builk.com/webhook-test/creful-kb-sync', {
  method: 'POST',
  headers,
  body: JSON.stringify({
    run_reason: 'demo sync',
    requested_by: 'codex',
    statuses: ['in_review', 'approved', 'published']
  })
});

console.log('STATUS:', response.status);
console.log(await response.text());
