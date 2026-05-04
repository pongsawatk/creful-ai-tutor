const ALLOWED_STATUSES = new Set(['in_review', 'approved', 'published']);

function prop(page, name) {
  return page.properties?.[name];
}

function richTextToPlain(parts = []) {
  return parts.map((p) => p.plain_text || p.text?.content || '').join('').trim();
}

function propertyText(page, name) {
  const p = prop(page, name);
  if (!p) return '';
  if (p.type === 'title') return richTextToPlain(p.title || []);
  if (p.type === 'rich_text') return richTextToPlain(p.rich_text || []);
  if (p.type === 'select') return p.select?.name || '';
  if (p.type === 'status') return p.status?.name || '';
  if (p.type === 'formula') return p.formula?.string || String(p.formula?.number || '');
  return '';
}

function propertyMulti(page, name) {
  const p = prop(page, name);
  if (!p) return [];
  if (p.type === 'multi_select') return (p.multi_select || []).map((x) => x.name).filter(Boolean);
  if (p.type === 'people') return (p.people || []).map((x) => x.name || x.id).filter(Boolean);
  return [];
}

const root = $input.first()?.json || {};
const results = root.results || root.body?.results || [];

return results
  .map((page) => {
    const docId = propertyText(page, 'Doc ID') || page.id;
    const status = propertyText(page, 'Status');

    return {
      json: {
        page_id: page.id,
        doc_id: docId,
        title: docId,
        status,
        module: propertyText(page, 'Module'),
        type: propertyText(page, 'Type'),
        authority: propertyText(page, 'Authority'),
        topic_tags: propertyMulti(page, 'Topic Tags'),
        reviewer: propertyMulti(page, 'Reviewer'),
        source_url: page.url || '',
        updated_at: page.last_edited_time || new Date().toISOString()
      }
    };
  })
  .filter((item) => ALLOWED_STATUSES.has(item.json.status));
