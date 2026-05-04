function stripBase64Whitespace(value) {
  return String(value || '').replace(/\s/g, '');
}

const payloads = $('Code - Build GitHub File Payloads').all();
const responses = $input.all();

return payloads.map((payloadItem, index) => {
  const file = payloadItem.json;
  const response = responses[index]?.json || {};
  const statusCode = response.statusCode || response.response?.statusCode;
  const body = response.body || response;
  const existingSha = body.sha || null;
  const existingContent = stripBase64Whitespace(body.content);
  const desiredContent = stripBase64Whitespace(file.content_base64);

  let action = 'create';
  if (statusCode === 404 || body.message === 'Not Found') {
    action = 'create';
  } else if (existingSha && existingContent === desiredContent) {
    action = 'skip';
  } else if (existingSha) {
    action = 'update';
  }

  const githubBody = {
    message: file.commit_message,
    content: file.content_base64
  };

  if (action === 'update') {
    githubBody.sha = existingSha;
  }

  return {
    json: {
      ...file,
      action,
      http_method: action === 'skip' ? 'GET' : 'PUT',
      github_body: action === 'skip' ? {} : githubBody,
      sha: existingSha
    }
  };
});
