import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const code = readFileSync(new URL('./creful-kb-sync.code.js', import.meta.url), 'utf8');

const workflow = {
  name: 'Creful KB Sync',
  nodes: [
    {
      parameters: {
        httpMethod: 'POST',
        path: 'creful-kb-sync',
        responseMode: 'lastNode',
        responseData: 'firstEntryJson',
        options: {}
      },
      id: randomUUID(),
      name: 'Manual Webhook - POST /creful-kb-sync',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [260, 300],
      webhookId: randomUUID()
    },
    {
      parameters: {
        mode: 'runOnceForAllItems',
        jsCode: code
      },
      id: randomUUID(),
      name: 'Code - Creful KB Sync',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [520, 300]
    }
  ],
  pinData: {},
  connections: {
    'Manual Webhook - POST /creful-kb-sync': {
      main: [
        [
          {
            node: 'Code - Creful KB Sync',
            type: 'main',
            index: 0
          }
        ]
      ]
    }
  },
  active: false,
  settings: {
    executionOrder: 'v1'
  },
  versionId: randomUUID(),
  meta: {
    instanceId: ''
  },
  id: '',
  tags: []
};

writeFileSync(
  new URL('./creful-kb-sync.workflow.json', import.meta.url),
  JSON.stringify(workflow, null, 2) + '\n'
);
