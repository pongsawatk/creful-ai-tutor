function richTextToMarkdown(parts = []) {
  return parts.map((part) => {
    const text = part.plain_text || part.text?.content || '';
    const href = part.href || part.text?.link?.url;
    let out = text;

    if (part.annotations?.code) out = '`' + out + '`';
    if (part.annotations?.bold) out = '**' + out + '**';
    if (part.annotations?.italic) out = '*' + out + '*';
    if (href) out = '[' + out + '](' + href + ')';

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
      line = '# ' + text;
      break;
    case 'heading_2':
      line = '## ' + text;
      break;
    case 'heading_3':
      line = '### ' + text;
      break;
    case 'bulleted_list_item':
      line = indent + '- ' + text;
      break;
    case 'numbered_list_item':
      line = indent + '1. ' + text;
      break;
    case 'to_do':
      line = indent + '- [' + (data.checked ? 'x' : ' ') + '] ' + text;
      break;
    case 'toggle':
      line = text ? indent + '<details><summary>' + text + '</summary>' : '';
      break;
    case 'quote':
    case 'callout':
      line = text ? '> ' + text : '';
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
      line = '[Image: ' + (data.caption ? richTextToMarkdown(data.caption) : data.file?.url || data.external?.url || 'Notion image') + ']';
      break;
    case 'bookmark':
    case 'embed':
    case 'link_preview':
      line = data.url ? '[' + type + ': ' + data.url + ']' : '';
      break;
    case 'child_page':
      line = '## ' + (data.title || 'Child page');
      break;
    default:
      line = text;
  }

  return line;
}

const rows = $('Code - Normalize Notion Rows').all();

return $input.all().map((item, index) => {
  const row = rows[index]?.json || {};
  const blocks = item.json.results || item.json.body?.results || [];
  const content = blocks
    .map((block) => blockToMarkdown(block))
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    json: {
      doc_id: row.doc_id,
      title: row.title || row.doc_id,
      status: row.status,
      module: row.module,
      type: row.type,
      authority: row.authority,
      topic_tags: row.topic_tags || [],
      source_url: row.source_url,
      content,
      updated_at: row.updated_at
    }
  };
});
