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

const chunks = $input.all().map((item) => item.json);
const used = new Map();
const commitMessage = `kb sync: Notion KB ${new Date().toISOString()}`;

const files = chunks.map((chunk) => {
  const base = safeFilename(chunk.doc_id);
  const count = used.get(base) || 0;
  used.set(base, count + 1);

  const filename = count === 0 ? `${base}.json` : `${base}_${count + 1}.json`;
  const path = `KB/${filename}`;
  const jsonText = JSON.stringify(chunk, null, 2) + '\n';

  return {
    json: {
      is_index: false,
      doc_id: chunk.doc_id,
      path,
      json_text: jsonText,
      content_base64: toBase64(jsonText),
      commit_message: commitMessage
    }
  };
});

const index = {
  source: 'notion',
  source_data_source_id: 'c52dad9d-1fa0-45af-a23b-68785536a494',
  status_filter: ['in_review', 'approved', 'published'],
  production_note: 'Before real rollout, tighten status_filter to published only.',
  count: chunks.length,
  updated_at: chunks.map((chunk) => chunk.updated_at).sort().at(-1) || null,
  docs: files.map((fileItem, index) => {
    const chunk = chunks[index];
    return {
      doc_id: chunk.doc_id,
      title: chunk.title,
      status: chunk.status,
      module: chunk.module,
      type: chunk.type,
      authority: chunk.authority,
      topic_tags: chunk.topic_tags || [],
      path: fileItem.json.path,
      source_url: chunk.source_url,
      updated_at: chunk.updated_at
    };
  })
};

const indexText = JSON.stringify(index, null, 2) + '\n';

files.push({
  json: {
    is_index: true,
    doc_id: '_index',
    path: 'KB/_index.json',
    json_text: indexText,
    content_base64: toBase64(indexText),
    commit_message: commitMessage
  }
});

return files;
