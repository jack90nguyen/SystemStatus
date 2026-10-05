const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1_000;
const REQUEST_TIMEOUT_MS = 10_000;
const RATE_LIMIT_CODES = new Set([9499, 99991400]);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function getRetryDelay(response, attempt) {
  const reset = parseInt(response?.headers.get('x-ogw-ratelimit-reset'), 10);
  if (reset > 0) return reset * 1000;
  return BASE_DELAY_MS * 2 ** attempt;
}

async function postOnce(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const data = await response.json().catch(() => ({}));
  const code = data.code ?? data.StatusCode ?? 0;
  const ok = response.ok && code === 0;
  const retryable = response.status === 429
    || response.status >= 500
    || RATE_LIMIT_CODES.has(code);
  return { ok, retryable, response, error: `HTTP ${response.status} code=${code} msg=${data.msg ?? ''}` };
}

async function sendLarkText(text) {
  const url = process.env.LARK_WEBHOOK_LINK;
  if (!url) return;

  const body = { msg_type: 'text', content: { text } };
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let result;
    try {
      result = await postOnce(url, body);
    } catch (err) {
      result = { ok: false, retryable: true, response: null, error: err.message };
    }
    if (result.ok) return;
    lastError = result.error;
    if (!result.retryable || attempt === MAX_RETRIES) break;
    await sleep(getRetryDelay(result.response, attempt));
  }
  throw new Error(`Lark webhook failed: ${lastError}`);
}

module.exports = { sendLarkText };
