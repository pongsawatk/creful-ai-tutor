const DEFAULT_STATUSES = ['in_review', 'approved', 'published'];
const DEFAULT_DATA_SOURCE_ID = 'c52dad9d-1fa0-45af-a23b-68785536a494';
const DEFAULT_REPO = 'pongsawatk/creful-ai-tutor';
const NOTION_VERSION = '2025-09-03';
const MAX_BLOCK_DEPTH = 6;

function getVars() {
  try {
    if (typeof $vars !== 'undefined') return $vars;
  } catch (_) {}
  return {};
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function requiredSecret(name, ...values) {
  const value = firstValue(...values);
  if (!value) {
    throw new Error(
      `Missing required secret/config: ${name}. Add it as an n8n Variable, or pass it in a test-only webhook header/body.`
    );
  }
  return value;
}

const webhookInput = $input.first()?.json || {};
const webhookBody = webhookInput.body || webhookInput;
const webhookHeaders = webhookInput.headers || {};
const vars = getVars();

const notionToken = requiredSecret(
  'NOTION_TOKEN',
  vars.NOTION_TOKEN,
  webhookHeaders['x-notion-token'],
  webhookBody.notion_token
);
const githubToken = requiredSecret(
  'GITHUB_TOKEN',
  vars.GITHUB_TOKEN,
  webhookHeaders['x-github-token'],
  webhookBody.github_token
);
const githubRepo = firstValue(
  vars.GITHUB_REPO,
  webhookHeaders['x-github-repo'],
  webhookBody.github_repo,
  DEFAULT_REPO
);
const notionDataSourceId = firstValue(
  vars.NOTION_DATA_SOURCE_ID,
  webhookHeaders['x-notion-data-source-id'],
  webhookBody.notion_data_source_id,
  DEFAULT_DATA_SOURCE_ID
);
const githubBranch = firstValue(
  vars.GITHUB_BRANCH,
  webhookHeaders['x-github-branch'],
  webhookBody.branch,
  ''
);

const statusFilter = Array.isArray(webhookBody.statuses) && webhookBody.statuses.length
  ? webhookBody.statuses
  : DEFAULT_STATUSES;

const commitMessage = `kb sync: Notion KB ${new Date().toISOString()}`;

async function httpRequest(options) {
  if (this?.helpers?.httpRequest) {
    return await this.helpers.httpRequest(options);
  }

  if (typeof fetch !== 'function') {
    throw new Error('No HTTP client available in this n8n Code node runtime.');
  }

  const url = new URL(options.url);
  if (options.qs) {
    for (const [key, value] of Object.entries(options.qs)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, value);
      }
    }
  }

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: options.headers || {},
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (_) {}

  if (!response.ok && !options.returnFullResponse) {
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  return options.returnFullResponse
    ? { statusCode: response.status, headers: Object.fromEntries(response.headers), body }
    : body;
}

async function requestJson(options) {
  try {
    return await httpRequest.call(this, {
      json: true,
      returnFullResponse: true,
      ...options,
      headers: {
        ...(options.headers || {})
      }
    });
  } catch (error) {
    const statusCode = error.statusCode || error.httpCode || error.response?.statusCode;
    const body = error.response?.body || error.cause?.response?.body || error.message;
    return { statusCode: statusCode || 500, body };
  }
}

function notionHeaders() {
  return {
    Authorization: `Bearer ${notionToken}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json'
  };
}

function githubHeaders() {
  return {
    Authorization: `Bearer ${githubToken}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  };
}

function assertOk(response, label) {
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`${label} failed with HTTP ${response.statusCode}: ${JSON.stringify(response.body)}`);
  }
  return response.body;
}

function property(page, name) {
  return page.properties?.[name];
}

function richTextToPlain(parts = []) {
  return parts.map((part) => part.plain_text || part.text?.content || '').join('').trim();
}

function propertyText(page, name) {
  const p = property(page, name);
  if (!p) return '';
  if (p.type === 'title') return richTextToPlain(p.title || []);
  if (p.type === 'rich_text') return richTextToPlain(p.rich_text || []);
  if (p.type === 'select') return p.select?.name || '';
  if (p.type === 'status') return p.status?.name || '';
  if (p.type === 'formula') return p.formula?.string || String(p.formula?.number || '');
  return '';
}

function propertyMulti(page, name) {
  const p = property(page, name);
  if (!p) return [];
  if (p.type === 'multi_select') return (p.multi_select || []).map((x) => x.name).filter(Boolean);
  if (p.type === 'people') return (p.people || []).map((x) => x.name || x.id).filter(Boolean);
  return [];
}

function normalizePage(page) {
  const docId = propertyText(page, 'Doc ID') || page.id;
  return {
    page_id: page.id,
    doc_id: docId,
    title: docId,
    status: propertyText(page, 'Status'),
    module: propertyText(page, 'Module'),
    type: propertyText(page, 'Type'),
    authority: propertyText(page, 'Authority'),
    topic_tags: propertyMulti(page, 'Topic Tags'),
    reviewer: propertyMulti(page, 'Reviewer'),
    source_url: page.url || '',
    updated_at: page.last_edited_time || new Date().toISOString()
  };
}

function richTextToMarkdown(parts = []) {
  return parts.map((part) => {
    const text = part.plain_text || part.text?.content || '';
    const href = part.href || part.text?.link?.url;
    let out = text;

    if (part.annotations?.code) out = '`' + out + '`';
    if (part.annotations?.bold) out = '**' + out + '**';
    if (part.annotations?.italic) out = '*' + out + '*';
    if (href) out = `[${out}](${href})`;

    return out;
  }).join('');
}

function blockToMarkdown(block, depth = 0) {
  const type = block.type;
  const data = block[type] || {};
  const text = richTextToMarkdown(data.rich_text || []);
  const indent = '  '.repeat(depth);
  let line = '';

  switch (type) {
    case 'paragraph':
      line = text;
      break;
    case 'heading_1':
      line = `# ${text}`;
      break;
    case 'heading_2':
      line = `## ${text}`;
      break;
    case 'heading_3':
      line = `### ${text}`;
      break;
    case 'bulleted_list_item':
      line = `${indent}- ${text}`;
      break;
    case 'numbered_list_item':
      line = `${indent}1. ${text}`;
      break;
    case 'to_do':
      line = `${indent}- [${data.checked ? 'x' : ' '}] ${text}`;
      break;
    case 'toggle':
      line = text ? `${indent}<details><summary>${text}</summary>` : '';
      break;
    case 'quote':
    case 'callout':
      line = text ? `> ${text}` : '';
      break;
    case 'code':
      line = '```' + (data.language || '') + '\n' + text + '\n```';
      break;
    case 'divider':
      line = '---';
      break;
    case 'table_row':
      line = '| ' + (data.cells || []).map((cell) => richTextToMarkdown(cell)).join(' | ') + ' |';
      break;
    case 'image':
      line = `[Image: ${data.caption ? richTextToMarkdown(data.caption) : data.file?.url || data.external?.url || 'Notion image'}]`;
      break;
    case 'bookmark':
    case 'embed':
    case 'link_preview':
      line = data.url ? `[${type}: ${data.url}]` : '';
      break;
    case 'child_page':
      line = `## ${data.title || 'Child page'}`;
      break;
    default:
      line = text;
  }

  const children = (block.children || [])
    .map((child) => blockToMarkdown(child, depth + 1))
    .filter(Boolean);

  if (type === 'toggle' && children.length) {
    return [line, ...children, `${indent}</details>`].filter(Boolean).join('\n');
  }

  return [line, ...children].filter(Boolean).join('\n');
}

function safeFilename(input) {
  return String(input || 'untitled')
    .normalize('NFKD')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .slice(0, 120) || 'untitled';
}

function toBase64(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

function stripBase64Whitespace(value) {
  return String(value || '').replace(/\s/g, '');
}

function githubContentUrl(path) {
  return `https://api.github.com/repos/${githubRepo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`;
}

async function queryNotionPages() {
  const pages = [];
  let cursor;

  do {
    const body = {
      page_size: 100,
      result_type: 'page',
      filter: {
        or: statusFilter.map((status) => ({
          property: 'Status',
          status: { equals: status }
        }))
      },
      sorts: [
        {
          timestamp: 'last_edited_time',
          direction: 'ascending'
        }
      ]
    };

    if (cursor) body.start_cursor = cursor;

    const response = await requestJson.call(this, {
      method: 'POST',
      url: `https://api.notion.com/v1/data_sources/${notionDataSourceId}/query`,
      headers: notionHeaders(),
      body
    });

    const data = assertOk(response, 'Notion data source query');
    pages.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  return pages;
}

async function fetchBlockChildren(blockId, depth = 0) {
  const blocks = [];
  let cursor;

  do {
    const qs = { page_size: 100 };
    if (cursor) qs.start_cursor = cursor;

    const response = await requestJson.call(this, {
      method: 'GET',
      url: `https://api.notion.com/v1/blocks/${blockId}/children`,
      qs,
      headers: notionHeaders()
    });

    const data = assertOk(response, `Notion block children ${blockId}`);

    for (const block of data.results || []) {
      if (block.has_children && depth < MAX_BLOCK_DEPTH) {
        block.children = await fetchBlockChildren.call(this, block.id, depth + 1);
      }
      blocks.push(block);
    }

    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  return blocks;
}

function buildFiles(chunks) {
  const usedNames = new Map();

  const docFiles = chunks.map((chunk) => {
    const base = safeFilename(chunk.doc_id);
    const count = usedNames.get(base) || 0;
    usedNames.set(base, count + 1);

    const filename = count === 0 ? `${base}.json` : `${base}_${count + 1}.json`;
    const path = `KB/${filename}`;
    const jsonText = JSON.stringify(chunk, null, 2) + '\n';

    return {
      is_index: false,
      doc_id: chunk.doc_id,
      path,
      json_text: jsonText,
      content_base64: toBase64(jsonText)
    };
  });

  const index = {
    source: 'notion',
    source_data_source_id: notionDataSourceId,
    status_filter: statusFilter,
    production_note: 'Before real rollout, tighten status_filter to published only.',
    count: chunks.length,
    updated_at: chunks.map((chunk) => chunk.updated_at).sort().at(-1) || null,
    docs: docFiles.map((file, index) => {
      const chunk = chunks[index];
      return {
        doc_id: chunk.doc_id,
        title: chunk.title,
        status: chunk.status,
        module: chunk.module,
        type: chunk.type,
        authority: chunk.authority,
        topic_tags: chunk.topic_tags || [],
        path: file.path,
        source_url: chunk.source_url,
        updated_at: chunk.updated_at
      };
    })
  };

  const indexText = JSON.stringify(index, null, 2) + '\n';

  return [
    ...docFiles,
    {
      is_index: true,
      doc_id: '_index',
      path: 'KB/_index.json',
      json_text: indexText,
      content_base64: toBase64(indexText)
    }
  ];
}

async function getExistingGithubFile(path) {
  const response = await requestJson.call(this, {
    method: 'GET',
    url: githubContentUrl(path),
    qs: githubBranch ? { ref: githubBranch } : undefined,
    headers: githubHeaders()
  });

  if (response.statusCode === 404) {
    return null;
  }

  return assertOk(response, `GitHub get ${path}`);
}

async function putGithubFile(file, existing) {
  const body = {
    message: commitMessage,
    content: file.content_base64
  };

  if (existing?.sha) body.sha = existing.sha;
  if (githubBranch) body.branch = githubBranch;

  const response = await requestJson.call(this, {
    method: 'PUT',
    url: githubContentUrl(file.path),
    headers: githubHeaders(),
    body
  });

  return assertOk(response, `GitHub put ${file.path}`);
}

const notionPages = await queryNotionPages.call(this);
const normalizedRows = notionPages
  .map(normalizePage)
  .filter((row) => statusFilter.includes(row.status));

const chunks = [];

for (const row of normalizedRows) {
  const blocks = await fetchBlockChildren.call(this, row.page_id);
  const content = blocks
    .map((block) => blockToMarkdown(block))
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  chunks.push({
    doc_id: row.doc_id,
    title: row.title,
    status: row.status,
    module: row.module,
    type: row.type,
    authority: row.authority,
    topic_tags: row.topic_tags || [],
    source_url: row.source_url,
    content,
    updated_at: row.updated_at
  });
}

const files = buildFiles(chunks);
const results = [];

for (const file of files) {
  const existing = await getExistingGithubFile.call(this, file.path);
  const existingContent = stripBase64Whitespace(existing?.content);
  const desiredContent = stripBase64Whitespace(file.content_base64);

  let action = existing ? 'update' : 'create';

  if (existing && existingContent === desiredContent) {
    action = 'skip';
  }

  let githubResult = null;
  if (action !== 'skip') {
    githubResult = await putGithubFile.call(this, file, existing);
  }

  results.push({
    ...file,
    action,
    sha: existing?.sha || null,
    new_sha: githubResult?.content?.sha || existing?.sha || null
  });
}

const docResults = results.filter((file) => !file.is_index);

return [
  {
    json: {
      ok: true,
      synced: docResults.length,
      created: docResults.filter((file) => file.action === 'create').length,
      updated: docResults.filter((file) => file.action === 'update').length,
      skipped: docResults.filter((file) => file.action === 'skip').length,
      commit_message: commitMessage,
      index_path: 'KB/_index.json'
    }
  }
];
