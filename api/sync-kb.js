const DEFAULT_SYNC_WEBHOOK_URL = "https://ct-automation.builk.com/webhook/creful-kb-sync";
const DEFAULT_SYNC_PASSWORD = "CrefulAI";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, {
      ok: false,
      error: "METHOD_NOT_ALLOWED",
      message: "Use POST to sync KB."
    });
  }

  const expectedPassword = process.env.KB_SYNC_PASSWORD || DEFAULT_SYNC_PASSWORD;
  const webhookUrl = process.env.KB_SYNC_WEBHOOK_URL || DEFAULT_SYNC_WEBHOOK_URL;

  if (!expectedPassword || !webhookUrl) {
    return sendJson(res, 500, {
      ok: false,
      error: "SYNC_NOT_CONFIGURED",
      message: "KB sync is not configured."
    });
  }

  try {
    const body = await readJsonBody(req);

    if (body.password !== expectedPassword) {
      return sendJson(res, 401, {
        ok: false,
        error: "INVALID_PASSWORD",
        message: "Invalid password."
      });
    }

    const payload = {
      run_reason: body.run_reason || "manual interface sync",
      requested_by: body.requested_by || "creful-interface",
      session_id: body.session_id || "",
      statuses: Array.isArray(body.statuses) && body.statuses.length
        ? body.statuses
        : ["in_review", "approved", "published"]
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    let webhookResponse;
    try {
      webhookResponse = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    const result = await readResponseBody(webhookResponse);

    if (!webhookResponse.ok) {
      return sendJson(res, 502, {
        ok: false,
        error: "WEBHOOK_FAILED",
        message: "KB sync webhook failed.",
        status: webhookResponse.status,
        result
      });
    }

    return sendJson(res, 200, {
      ok: true,
      status: webhookResponse.status,
      result
    });
  } catch (error) {
    const isAbort = error.name === "AbortError";

    return sendJson(res, isAbort ? 504 : 500, {
      ok: false,
      error: isAbort ? "WEBHOOK_TIMEOUT" : "SYNC_FAILED",
      message: isAbort ? "KB sync webhook timed out." : "KB sync failed."
    });
  }
};

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");

  const chunks = [];

  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

async function readResponseBody(response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
