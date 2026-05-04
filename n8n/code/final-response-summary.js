const files = $('Code - Diff GitHub Files').all().map((item) => item.json);
const responsesByPath = new Map(
  $input.all().map((item) => {
    const response = item.json;
    const path = response.body?.content?.path || response.body?.path || response.path;
    return [path, response];
  })
);
const docs = files.filter((file) => !file.is_index);
const first = files[0] || {};

function isSuccessStatus(statusCode) {
  return statusCode >= 200 && statusCode < 300;
}

const results = files.map((file) => {
  const response = file.action === 'skip'
    ? {}
    : responsesByPath.get(file.path) || {};
  const statusCode = response.statusCode || response.response?.statusCode || response.body?.status;
  const skipped = file.action === 'skip';
  const success = skipped || isSuccessStatus(statusCode);

  return {
    path: file.path,
    action: file.action,
    status_code: statusCode || null,
    success,
    error: success ? null : response.body?.message || response.message || 'GitHub write failed'
  };
});

const docResults = results.filter((file) => file.path !== 'KB/_index.json');
const failures = results.filter((file) => !file.success);

return [
  {
    json: {
      ok: failures.length === 0,
      synced: docResults.filter((file) => file.success).length,
      created: docResults.filter((file) => file.success && file.action === 'create').length,
      updated: docResults.filter((file) => file.success && file.action === 'update').length,
      skipped: docs.filter((file) => file.action === 'skip').length,
      failed: failures.length,
      commit_message: first.commit_message || '',
      index_path: 'KB/_index.json',
      errors: failures.slice(0, 10)
    }
  }
];
