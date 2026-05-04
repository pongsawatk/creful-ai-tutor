import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const notionDataSourceId = 'c52dad9d-1fa0-45af-a23b-68785536a494';
const githubRepo = 'pongsawatk/creful-ai-tutor';

function readCode(name) {
  return readFileSync(new URL(`./code/${name}.js`, import.meta.url), 'utf8');
}

function node(name, type, typeVersion, position, parameters, extra = {}) {
  return {
    id: randomUUID(),
    name,
    type,
    typeVersion,
    position,
    parameters,
    ...extra
  };
}

function httpAuthCredential(name) {
  return {
    httpHeaderAuth: {
      id: '__REPLACE_AFTER_IMPORT__',
      name
    }
  };
}

const workflow = {
  name: 'Creful KB Sync - Credentials',
  nodes: [
    node(
      'Manual Webhook - POST /creful-kb-sync',
      'n8n-nodes-base.webhook',
      2,
      [180, 300],
      {
        httpMethod: 'POST',
        path: 'creful-kb-sync',
        responseMode: 'lastNode',
        responseData: 'firstEntryJson',
        options: {}
      },
      { webhookId: randomUUID() }
    ),
    node(
      'Notion - Query KB Rows',
      'n8n-nodes-base.httpRequest',
      4.2,
      [460, 300],
      {
        method: 'POST',
        url: `https://api.notion.com/v1/data_sources/${notionDataSourceId}/query`,
        authentication: 'genericCredentialType',
        genericAuthType: 'httpHeaderAuth',
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'Notion-Version', value: '2025-09-03' },
            { name: 'Content-Type', value: 'application/json' }
          ]
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: JSON.stringify(
          {
            page_size: 100,
            result_type: 'page',
            filter: {
              or: [
                { property: 'Status', status: { equals: 'in_review' } },
                { property: 'Status', status: { equals: 'approved' } },
                { property: 'Status', status: { equals: 'published' } }
              ]
            },
            sorts: [{ timestamp: 'last_edited_time', direction: 'ascending' }]
          },
          null,
          2
        ),
        options: {}
      },
      { credentials: httpAuthCredential('Creful Notion Authorization') }
    ),
    node(
      'Code - Normalize Notion Rows',
      'n8n-nodes-base.code',
      2,
      [740, 300],
      {
        mode: 'runOnceForAllItems',
        jsCode: readCode('normalize-notion-rows')
      }
    ),
    node(
      'Notion - Fetch Page Blocks',
      'n8n-nodes-base.httpRequest',
      4.2,
      [1020, 300],
      {
        method: 'GET',
        url: "={{ 'https://api.notion.com/v1/blocks/' + $json.page_id + '/children' }}",
        authentication: 'genericCredentialType',
        genericAuthType: 'httpHeaderAuth',
        sendQuery: true,
        queryParameters: {
          parameters: [{ name: 'page_size', value: '100' }]
        },
        sendHeaders: true,
        headerParameters: {
          parameters: [{ name: 'Notion-Version', value: '2025-09-03' }]
        },
        options: {}
      },
      { credentials: httpAuthCredential('Creful Notion Authorization') }
    ),
    node(
      'Code - Convert Blocks To Chunks',
      'n8n-nodes-base.code',
      2,
      [1300, 300],
      {
        mode: 'runOnceForAllItems',
        jsCode: readCode('convert-blocks-to-chunks')
      }
    ),
    node(
      'Code - Build GitHub File Payloads',
      'n8n-nodes-base.code',
      2,
      [1580, 300],
      {
        mode: 'runOnceForAllItems',
        jsCode: readCode('build-github-file-payloads')
      }
    ),
    node(
      'GitHub - Get Existing File',
      'n8n-nodes-base.httpRequest',
      4.2,
      [1860, 300],
      {
        method: 'GET',
        url: `={{ 'https://api.github.com/repos/${githubRepo}/contents/' + encodeURIComponent($json.path).replace(/%2F/g, '/') }}`,
        authentication: 'genericCredentialType',
        genericAuthType: 'httpHeaderAuth',
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'Accept', value: 'application/vnd.github+json' },
            { name: 'X-GitHub-Api-Version', value: '2022-11-28' }
          ]
        },
        options: {
          batching: {
            batch: {
              batchSize: 1,
              batchInterval: 1000
            }
          },
          response: {
            response: {
              fullResponse: true,
              neverError: true,
              responseFormat: 'json'
            }
          }
        }
      },
      { credentials: httpAuthCredential('Creful GitHub Authorization') }
    ),
    node(
      'Code - Diff GitHub Files',
      'n8n-nodes-base.code',
      2,
      [2140, 300],
      {
        mode: 'runOnceForAllItems',
        jsCode: readCode('diff-github-files')
      }
    ),
    node(
      'GitHub - Create Update Or Confirm Skip',
      'n8n-nodes-base.httpRequest',
      4.2,
      [2420, 300],
      {
        method: '={{ $json.http_method }}',
        url: `={{ 'https://api.github.com/repos/${githubRepo}/contents/' + encodeURIComponent($json.path).replace(/%2F/g, '/') }}`,
        authentication: 'genericCredentialType',
        genericAuthType: 'httpHeaderAuth',
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'Accept', value: 'application/vnd.github+json' },
            { name: 'X-GitHub-Api-Version', value: '2022-11-28' },
            { name: 'Content-Type', value: 'application/json' }
          ]
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ $json.github_body }}',
        options: {
          batching: {
            batch: {
              batchSize: 1,
              batchInterval: 1000
            }
          },
          response: {
            response: {
              fullResponse: true,
              neverError: true,
              responseFormat: 'json'
            }
          }
        }
      },
      { credentials: httpAuthCredential('Creful GitHub Authorization') }
    ),
    node(
      'Code - Final Response Summary',
      'n8n-nodes-base.code',
      2,
      [2700, 300],
      {
        mode: 'runOnceForAllItems',
        jsCode: readCode('final-response-summary')
      }
    )
  ],
  pinData: {},
  connections: {
    'Manual Webhook - POST /creful-kb-sync': {
      main: [[{ node: 'Notion - Query KB Rows', type: 'main', index: 0 }]]
    },
    'Notion - Query KB Rows': {
      main: [[{ node: 'Code - Normalize Notion Rows', type: 'main', index: 0 }]]
    },
    'Code - Normalize Notion Rows': {
      main: [[{ node: 'Notion - Fetch Page Blocks', type: 'main', index: 0 }]]
    },
    'Notion - Fetch Page Blocks': {
      main: [[{ node: 'Code - Convert Blocks To Chunks', type: 'main', index: 0 }]]
    },
    'Code - Convert Blocks To Chunks': {
      main: [[{ node: 'Code - Build GitHub File Payloads', type: 'main', index: 0 }]]
    },
    'Code - Build GitHub File Payloads': {
      main: [[{ node: 'GitHub - Get Existing File', type: 'main', index: 0 }]]
    },
    'GitHub - Get Existing File': {
      main: [[{ node: 'Code - Diff GitHub Files', type: 'main', index: 0 }]]
    },
    'Code - Diff GitHub Files': {
      main: [[{ node: 'GitHub - Create Update Or Confirm Skip', type: 'main', index: 0 }]]
    },
    'GitHub - Create Update Or Confirm Skip': {
      main: [[{ node: 'Code - Final Response Summary', type: 'main', index: 0 }]]
    }
  },
  active: false,
  settings: {
    executionOrder: 'v1'
  },
  versionId: randomUUID(),
  meta: {
    templateCredsSetupCompleted: false,
    instanceId: ''
  },
  id: '',
  tags: []
};

writeFileSync(
  new URL('./creful-kb-sync.credentials.workflow.json', import.meta.url),
  JSON.stringify(workflow, null, 2) + '\n'
);
