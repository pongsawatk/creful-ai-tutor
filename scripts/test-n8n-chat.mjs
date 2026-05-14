import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DEFAULT_URL = 'https://ct-automation.builk.com/webhook-test/creful-ai-tutor-chat';
const DEFAULT_CASE_ID = 'happy-path-rfi';
const REQUIRED_FIELDS = [
  'answer',
  'kb_relevance',
  'confidence',
  'doc_id',
  'escalate',
  'escalate_reason',
  'model',
  'trace_id',
];
const BANNED_PERSONA_TERMS = ['ค่ะ', 'นะคะ', 'จ้า', 'จ้ะ', 'นะจ๊ะ'];
const RAW_CITATION_PATTERN = '*(' + '📚 ข้อมูล:';
const TIMEOUT_MS = 120_000;

function printUsage() {
  console.log(`Usage:
  node scripts/test-n8n-chat.mjs
  node scripts/test-n8n-chat.mjs --case <id>
  node scripts/test-n8n-chat.mjs --all
  node scripts/test-n8n-chat.mjs --url <webhook-url>

Options:
  --case <id>       Run one test case. Default: ${DEFAULT_CASE_ID}
  --all             Run every test case with an Enter pause before each case
  --url <url>       Override webhook URL. Env override: CREFUL_WEBHOOK_URL
  -h, --help        Show this help
`);
}

function parseArgs(argv) {
  const args = {
    all: false,
    caseId: DEFAULT_CASE_ID,
    url: process.env.CREFUL_WEBHOOK_URL || DEFAULT_URL,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--all') {
      args.all = true;
      continue;
    }

    if (arg === '--case') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --case');
      }
      args.caseId = value;
      i += 1;
      continue;
    }

    if (arg === '--url') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --url');
      }
      args.url = value;
      i += 1;
      continue;
    }

    if (arg === '-h' || arg === '--help') {
      args.help = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

async function loadCases() {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const filePath = join(currentDir, 'test-cases.json');
  const raw = await readFile(filePath, 'utf8');
  const cases = JSON.parse(raw);

  if (!Array.isArray(cases)) {
    throw new Error('scripts/test-cases.json must contain an array');
  }

  return cases;
}

function formatJson(value) {
  return JSON.stringify(value, null, 2);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNumberPercentOrNull(value) {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100);
}

function validationItem(label, passed, detail = '') {
  return {
    label,
    passed,
    detail,
    warnOnly: false,
  };
}

function warningItem(label, passed, detail = '') {
  return {
    label,
    passed,
    detail,
    warnOnly: true,
  };
}

function validateResponse({ status, parsedBody, parseError, rawBody }) {
  const body = parsedBody;
  const requiredMissing = isPlainObject(body)
    ? REQUIRED_FIELDS.filter((field) => !Object.prototype.hasOwnProperty.call(body, field))
    : REQUIRED_FIELDS;
  const answer = isPlainObject(body) ? body.answer : undefined;
  const kbRelevance = isPlainObject(body) ? body.kb_relevance : undefined;
  const confidence = isPlainObject(body) ? body.confidence : undefined;
  const escalate = isPlainObject(body) ? body.escalate : undefined;
  const model = isPlainObject(body) ? body.model : undefined;
  const traceId = isPlainObject(body) ? body.trace_id : undefined;
  const answerText = typeof answer === 'string' ? answer : '';
  const bannedFound = BANNED_PERSONA_TERMS.filter((term) => answerText.includes(term));

  const checks = [
    validationItem('HTTP status is 2xx', status >= 200 && status <= 299, `status=${status}`),
    validationItem('Response body is valid JSON object', !parseError && isPlainObject(body), parseError ? parseError.message : ''),
    validationItem(
      `Required fields exist: ${REQUIRED_FIELDS.join(', ')}`,
      requiredMissing.length === 0,
      requiredMissing.length ? `missing=${requiredMissing.join(', ')}` : '',
    ),
    validationItem('answer is a non-empty string', typeof answer === 'string' && answer.trim().length > 0),
    validationItem('kb_relevance is number 0-100 or null', isNumberPercentOrNull(kbRelevance), `value=${String(kbRelevance)}`),
    validationItem('confidence is number 0-100 or null', isNumberPercentOrNull(confidence), `value=${String(confidence)}`),
    validationItem('escalate is boolean', typeof escalate === 'boolean', `value=${String(escalate)}`),
    validationItem('model is a non-empty string', typeof model === 'string' && model.trim().length > 0),
    validationItem('trace_id starts with trace_', typeof traceId === 'string' && traceId.startsWith('trace_'), `value=${String(traceId)}`),
    validationItem(
      'Thai persona has no banned feminine/casual particles',
      bannedFound.length === 0,
      bannedFound.length ? `found=${bannedFound.join(', ')}` : '',
    ),
    warningItem('Thai persona includes ครับ', answerText.includes('ครับ'), 'warning only'),
    validationItem('answer has no raw citation marker', !answerText.includes(RAW_CITATION_PATTERN)),
    validationItem('answer has no ESCALATE: marker', !answerText.includes('ESCALATE:')),
  ];

  const failedChecks = checks.filter((check) => !check.passed && !check.warnOnly);
  const warningChecks = checks.filter((check) => !check.passed && check.warnOnly);
  const issues = [
    ...failedChecks.map((check) => check.detail ? `${check.label} (${check.detail})` : check.label),
    ...warningChecks.map((check) => check.detail ? `WARN: ${check.label} (${check.detail})` : `WARN: ${check.label}`),
  ];

  if (status === 404) {
    issues.push('DIAGNOSIS: webhook-test is probably not listening. Click "Listen for test event" in n8n and retry within 2 minutes.');
  }

  if (rawBody && rawBody.includes('webhook') && rawBody.includes('not registered')) {
    issues.push('DIAGNOSIS: n8n reports webhook not registered; the test listener was likely not started or expired.');
  }

  return {
    passed: failedChecks.length === 0,
    checks,
    issues,
  };
}

async function postCase(testCase, url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Request timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS);
  const started = performance.now();

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(testCase.payload),
      signal: controller.signal,
    });
    const rawBody = await response.text();
    const timeMs = Math.round(performance.now() - started);

    let parsedBody = null;
    let parseError = null;
    if (rawBody.trim().length > 0) {
      try {
        parsedBody = JSON.parse(rawBody);
      } catch (error) {
        parseError = error;
      }
    } else {
      parseError = new Error('Response body is empty');
    }

    return {
      status: response.status,
      rawBody,
      parsedBody,
      parseError,
      timeMs,
      networkError: null,
    };
  } catch (error) {
    return {
      status: 0,
      rawBody: '',
      parsedBody: null,
      parseError: null,
      timeMs: Math.round(performance.now() - started),
      networkError: error,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function printCaseHeader(testCase, url) {
  console.log('\n============================================================');
  console.log(`Case ID: ${testCase.id}`);
  console.log(`URL: ${url}`);
  console.log('Payload:');
  console.log(formatJson(testCase.payload));
  console.log('============================================================');
}

function printResponse(result) {
  console.log('\nResponse:');
  if (result.networkError) {
    console.log(`Network error: ${result.networkError.message}`);
    console.log(`Response time: ${result.timeMs} ms`);
    return;
  }

  console.log(`HTTP status: ${result.status}`);
  console.log('Response body:');
  if (result.parseError) {
    console.log(result.rawBody || '<empty>');
  } else {
    console.log(formatJson(result.parsedBody));
  }
  console.log(`Response time: ${result.timeMs} ms`);
}

function printChecklist(validation) {
  console.log('\nValidation checklist:');
  for (const check of validation.checks) {
    const icon = check.passed ? '✅' : check.warnOnly ? '⚠️' : '❌';
    const suffix = check.detail ? ` (${check.detail})` : '';
    console.log(`${icon} ${check.label}${suffix}`);
  }
  console.log(`\nCase result: ${validation.passed ? '✅ PASS' : '❌ FAIL'}`);
}

function printSummary(results) {
  console.log('\nSummary report:');
  console.log('| Case ID | Status | Time (ms) | Issues |');
  console.log('|---|---|---:|---|');
  for (const result of results) {
    const issues = result.issues.length ? result.issues.join('; ').replaceAll('\n', ' ') : '-';
    console.log(`| ${result.id} | ${result.passed ? '✅ PASS' : '❌ FAIL'} | ${result.timeMs} | ${issues} |`);
  }
}

async function pauseForListen(rl, testCase, isFirstCase) {
  const prefix = isFirstCase ? 'Before this case' : 'Before the next case';
  await rl.question(
    `${prefix}, click "Listen for test event" on the n8n Webhook node, then press Enter to run ${testCase.id}. ` +
      'The webhook-test URL expires about 2 minutes after listening. ',
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return 0;
  }

  const cases = await loadCases();
  const selectedCases = args.all
    ? cases
    : cases.filter((testCase) => testCase.id === args.caseId);

  if (selectedCases.length === 0) {
    throw new Error(`Unknown case id: ${args.caseId}`);
  }

  console.log('n8n webhook E2E tester for CrefulLab');
  console.log(`Target URL: ${args.url}`);
  console.log('Important: webhook-test accepts one request per "Listen for test event" click and expires in about 2 minutes.');

  const rl = args.all ? createInterface({ input, output }) : null;
  const results = [];

  try {
    for (let index = 0; index < selectedCases.length; index += 1) {
      const testCase = selectedCases[index];
      if (args.all) {
        await pauseForListen(rl, testCase, index === 0);
      }

      printCaseHeader(testCase, args.url);
      const result = await postCase(testCase, args.url);
      printResponse(result);

      let validation;
      if (result.networkError) {
        validation = {
          passed: false,
          checks: [
            validationItem('HTTP request completed', false, result.networkError.message),
          ],
          issues: [`Network error: ${result.networkError.message}`],
        };
        if (result.networkError.name === 'AbortError' || result.networkError.message.includes('timed out')) {
          validation.issues.push('DIAGNOSIS: request timed out; check whether the workflow is active/listening and whether upstream services such as OpenRouter are responding.');
        }
      } else {
        validation = validateResponse(result);
      }

      printChecklist(validation);
      results.push({
        id: testCase.id,
        passed: validation.passed,
        timeMs: result.timeMs,
        issues: validation.issues,
      });
    }
  } finally {
    rl?.close();
  }

  printSummary(results);

  return results.every((result) => result.passed) ? 0 : 1;
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    console.error(`\nFatal: ${error.message}`);
    process.exitCode = 1;
  });
