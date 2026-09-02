/**
 * SMS provider adapters.
 *
 * Every adapter exposes `send({ to, text, env })` and resolves to:
 *   { ok, id, status, retryable, error }
 *
 * `retryable` marks failures worth trying again (network blips, 429, 5xx).
 * Permanent rejections (bad number, unapproved sender, no credit) are not
 * retried — retrying them only burns the hourly budget.
 */

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function need(env, ...keys) {
  const missing = keys.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing environment variable(s): ${missing.join(', ')}`);
  }
  return keys.map((key) => env[key]);
}

async function post(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    // DNS failure, socket reset, timeout — always worth another attempt.
    return { ok: false, retryable: true, error: `network: ${error.message}` };
  }

  const raw = await response.text();
  let body;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    body = { raw };
  }

  return {
    ok: response.ok,
    status: response.status,
    retryable: RETRYABLE_STATUS.has(response.status),
    body,
    raw,
  };
}

/**
 * Taqnyat — https://dev.taqnyat.sa
 * POST /v1/messages with a Bearer token.
 */
const taqnyat = {
  label: 'Taqnyat',
  requiredEnv: ['TAQNYAT_TOKEN', 'SMS_SENDER'],
  async send({ to, text, env }) {
    const [token, sender] = need(env, 'TAQNYAT_TOKEN', 'SMS_SENDER');
    const result = await post('https://api.taqnyat.sa/v1/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ recipients: [to], body: text, sender }),
    });

    if (result.ok === false && result.error) return result;

    // Taqnyat answers 201 with a statusCode of its own; anything else is a reject.
    const accepted = result.ok && Number(result.body?.statusCode ?? 0) < 300;
    return {
      ok: accepted,
      id: result.body?.messageId,
      status: result.status,
      retryable: result.retryable,
      error: accepted ? undefined : result.raw?.slice(0, 300),
    };
  },
};

/**
 * Unifonic — https://docs.unifonic.com
 * POST /rest/SMS/messages with the application SID in the body.
 */
const unifonic = {
  label: 'Unifonic',
  requiredEnv: ['UNIFONIC_APPSID', 'SMS_SENDER'],
  async send({ to, text, env }) {
    const [appSid, sender] = need(env, 'UNIFONIC_APPSID', 'SMS_SENDER');
    const result = await post('https://el.cloud.unifonic.com/rest/SMS/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        AppSid: appSid,
        SenderID: sender,
        Recipient: to,
        Body: text,
        responseType: 'JSON',
      }),
    });

    if (result.ok === false && result.error) return result;

    const accepted = result.ok && result.body?.success !== 'false' && result.body?.success !== false;
    return {
      ok: accepted,
      id: result.body?.data?.MessageID,
      status: result.status,
      retryable: result.retryable,
      error: accepted ? undefined : result.raw?.slice(0, 300),
    };
  },
};

/**
 * Twilio — https://www.twilio.com/docs/sms
 * Form-encoded POST with HTTP Basic auth.
 */
const twilio = {
  label: 'Twilio',
  requiredEnv: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'SMS_SENDER'],
  async send({ to, text, env }) {
    const [sid, token, sender] = need(
      env,
      'TWILIO_ACCOUNT_SID',
      'TWILIO_AUTH_TOKEN',
      'SMS_SENDER',
    );
    const form = new URLSearchParams({ To: `+${to}`, From: sender, Body: text });
    const result = await post(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      },
    );

    if (result.ok === false && result.error) return result;

    return {
      ok: result.ok,
      id: result.body?.sid,
      status: result.status,
      retryable: result.retryable,
      error: result.ok ? undefined : result.raw?.slice(0, 300),
    };
  },
};

/**
 * Generic JSON gateway, for a provider not covered above (4Jawaly, Msegat, …).
 *
 * Configure with:
 *   SMS_CUSTOM_URL      full endpoint
 *   SMS_CUSTOM_HEADERS  JSON object of headers
 *   SMS_CUSTOM_BODY     JSON body template; {{to}}, {{text}} and {{sender}}
 *                       are substituted before the request is sent
 *
 * Copy the exact shape out of your provider's own documentation — that is the
 * only part of this file you should ever need to touch.
 */
const custom = {
  label: 'Custom gateway',
  requiredEnv: ['SMS_CUSTOM_URL', 'SMS_CUSTOM_BODY'],
  async send({ to, text, env }) {
    const [url, template] = need(env, 'SMS_CUSTOM_URL', 'SMS_CUSTOM_BODY');
    const headers = {
      'Content-Type': 'application/json',
      ...JSON.parse(env.SMS_CUSTOM_HEADERS || '{}'),
    };
    const body = template
      .replaceAll('{{to}}', to)
      .replaceAll('{{text}}', JSON.stringify(text).slice(1, -1))
      .replaceAll('{{sender}}', env.SMS_SENDER || '');

    const result = await post(url, { method: 'POST', headers, body });
    if (result.ok === false && result.error) return result;

    return {
      ok: result.ok,
      id: result.body?.id ?? result.body?.messageId,
      status: result.status,
      retryable: result.retryable,
      error: result.ok ? undefined : result.raw?.slice(0, 300),
    };
  },
};

/** Prints what would be sent and reports success. Never touches the network. */
const dryRun = {
  label: 'Dry run',
  requiredEnv: [],
  async send({ to, text }) {
    return { ok: true, id: `dry-${to}`, status: 200, preview: text };
  },
};

export const providers = { taqnyat, unifonic, twilio, custom, 'dry-run': dryRun };
