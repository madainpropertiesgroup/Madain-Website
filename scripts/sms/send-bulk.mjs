#!/usr/bin/env node
/**
 * Paced bulk SMS sender.
 *
 * Reads recipients from a CSV, renders one message per row, and sends them at a
 * fixed hourly rate (default 50/hour) so the run stays inside carrier and
 * provider throttles.
 *
 * Two properties matter more than speed for a list of real customers:
 *
 *   1. It never sends twice. Every attempt is appended to a job log before the
 *      next one goes out, and a re-run skips whatever the log already shows as
 *      delivered. Kill it, reboot, run it again — safe.
 *   2. It does not send by accident. A run is a dry run unless you pass --live.
 *
 * Usage:
 *   node scripts/sms/send-bulk.mjs --file list.csv --template msg.txt
 *   node scripts/sms/send-bulk.mjs --file list.csv --template msg.txt --live
 *
 * Run with --help for the full option list.
 */

import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { providers } from './providers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULTS = {
  rate: 50,           // messages per hour
  provider: 'unifonic',
  column: 'phone',
  country: '971',     // United Arab Emirates
  retries: 3,
  pacing: 'spread',   // 'spread' = one every 3600/rate s, 'burst' = a batch per hour
  window: '07:00-21:00', // TDRA: no promotional SMS between 21:00 and 07:00
};

/**
 * Mobile number shapes per country code, used to reject landlines and typos
 * before they cost anything. Both the UAE and Saudi Arabia are <cc> + 5 + 8
 * digits. Countries not listed fall back to a plain length check.
 */
const MOBILE_PATTERNS = {
  971: /^9715\d{8}$/,  // UAE   — e&, du, Virgin
  966: /^9665\d{8}$/,  // Saudi — STC, Mobily, Zain
};

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const args = { ...DEFAULTS, live: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (key === 'live' || key === 'help') {
      args[key] = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Option --${key} needs a value`);
    }
    args[key] = value;
    i += 1;
  }
  args.rate = Number(args.rate);
  args.retries = Number(args.retries);
  if (args.limit !== undefined) args.limit = Number(args.limit);
  if (!Number.isFinite(args.rate) || args.rate <= 0) {
    throw new Error('--rate must be a positive number of messages per hour');
  }
  return args;
}

const HELP = `
Paced bulk SMS sender

  --file <path>       CSV of recipients (required)
  --template <path>   message template file; {{column}} pulls from the CSV
  --text "<message>"  inline message, instead of --template
  --provider <name>   ${Object.keys(providers).join(' | ')}   (default: ${DEFAULTS.provider})
  --rate <n>          messages per hour (default: ${DEFAULTS.rate})
  --pacing <mode>     spread = evenly across the hour (default) | burst = a batch on the hour
  --column <name>     CSV column holding the number (default: ${DEFAULTS.column})
  --country <code>    country code for local numbers (default: ${DEFAULTS.country})
  --window <range>    permitted sending hours, local time (default: ${DEFAULTS.window})
                      TDRA bars promotional SMS 21:00-07:00; "off" for OTP/alerts
  --job <name>        job name; its log makes the run resumable (default: CSV filename)
  --limit <n>         stop after n messages this run
  --retries <n>       attempts per message on transient errors (default: ${DEFAULTS.retries})
  --live              actually send; without it nothing leaves the machine
  --help              this text

Examples
  # See exactly what would go out, and to whom
  node scripts/sms/send-bulk.mjs --file customers.csv --template message.txt

  # Send for real, 50 an hour, one message every 72 seconds
  node scripts/sms/send-bulk.mjs --file customers.csv --template message.txt --live

  # Interrupted? The same command picks up where it stopped.
`;

// ---------------------------------------------------------------------- CSV

/** Minimal RFC 4180 parser: quoted fields, escaped quotes, newlines in quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  const source = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => r.some((cell) => cell.trim() !== ''));
  if (nonEmpty.length === 0) return [];

  const headers = nonEmpty[0].map((h) => h.trim());
  return nonEmpty.slice(1).map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, (cells[index] ?? '').trim()])),
  );
}

// ------------------------------------------------------------------ numbers

/**
 * Normalise to bare international digits (no +, no leading zeros): 9665XXXXXXXX.
 * Returns null for anything that cannot be a mobile number.
 */
function normalisePhone(raw, countryCode) {
  if (!raw) return null;
  let digits = String(raw).replace(/[^\d+]/g, '');

  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = countryCode + digits.slice(1);
  else if (!digits.startsWith(countryCode)) digits = countryCode + digits;

  if (!/^\d{10,15}$/.test(digits)) return null;

  const pattern = MOBILE_PATTERNS[countryCode];
  if (pattern && !pattern.test(digits)) return null;

  return digits;
}

// ------------------------------------------------------------- sending hours

/**
 * The UAE's TDRA bars promotional SMS between 21:00 and 07:00, and fines run to
 * AED 400,000 per violation. A 300-message run at 50/hour takes six hours, so
 * it is entirely possible to start legally and finish illegally — the sender
 * therefore pauses at the edge of the window and resumes when it reopens,
 * rather than trusting whoever launched it to have done the arithmetic.
 *
 * Times are the machine's local time. Pass --window off for transactional
 * messages (OTP, delivery alerts), which the rule does not restrict.
 */
function parseWindow(spec) {
  if (!spec || spec === 'off') return null;
  const match = spec.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!match) throw new Error(`--window must look like 07:00-21:00 (or "off"), got "${spec}"`);
  const [, h1, m1, h2, m2] = match.map(Number);
  const open = h1 * 60 + m1;
  const close = h2 * 60 + m2;
  if (open === close) throw new Error('--window start and end cannot be the same time');
  return { open, close, spec };
}

/** Minutes to wait before the window is open; 0 when it already is. */
function minutesUntilOpen(window, now = new Date()) {
  if (!window) return 0;
  const current = now.getHours() * 60 + now.getMinutes();
  const { open, close } = window;

  // A window that wraps past midnight (e.g. 22:00-06:00) is open outside [close, open).
  const isOpen = open < close
    ? current >= open && current < close
    : current >= open || current < close;
  if (isOpen) return 0;

  return current < open ? open - current : 24 * 60 - current + open;
}

// ----------------------------------------------------------------- messages

function renderTemplate(template, row) {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, key) => {
    const value = row[key];
    if (value === undefined) throw new Error(`Template placeholder {{${key}}} has no CSV column`);
    return value;
  });
}

/**
 * GSM-03.38 messages fit 160 characters per part; anything with Arabic (or an
 * emoji) switches the whole message to UCS-2 at 70 characters per part. Knowing
 * the part count before sending is the difference between a 300 SAR run and a
 * 900 SAR one.
 */
function segmentCount(text) {
  const unicode = /[^\u0000-\u007F]/.test(text);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  return text.length <= single ? 1 : Math.ceil(text.length / multi);
}

// --------------------------------------------------------------------- log

/** Append-only JSONL. Written before the next send, so a crash cannot duplicate. */
function loadSent(logPath) {
  const sent = new Map();
  if (!existsSync(logPath)) return sent;
  for (const line of readFileSync(logPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.ok) sent.set(entry.to, entry);
    } catch {
      // A torn final line from a hard kill: ignore it. The number simply counts
      // as unsent and goes out on this run.
    }
  }
  return sent;
}

// ------------------------------------------------------------------ helpers

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function loadDotEnv() {
  const env = { ...process.env };
  const envPath = resolve(HERE, '../../.env');
  if (!existsSync(envPath)) return env;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    if (line.trim().startsWith('#')) continue;
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
    if (env[match[1]] === undefined) env[match[1]] = value;
  }
  return env;
}

const clock = () => new Date().toTimeString().slice(0, 8);

// --------------------------------------------------------------------- main

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  if (!args.file) throw new Error('--file is required (see --help)');
  if (!args.template && !args.text) throw new Error('--template or --text is required');

  const provider = providers[args.provider];
  if (!provider) {
    throw new Error(`Unknown provider "${args.provider}". Try: ${Object.keys(providers).join(', ')}`);
  }

  const env = loadDotEnv();
  const template = args.text ?? readFileSync(resolve(args.template), 'utf8').trim();
  const rows = parseCsv(readFileSync(resolve(args.file), 'utf8'));
  if (rows.length === 0) throw new Error(`No rows in ${args.file}`);

  // Build the queue: normalise, drop invalid, drop duplicates.
  const queue = [];
  const invalid = [];
  const seen = new Set();

  for (const [index, row] of rows.entries()) {
    const phone = normalisePhone(row[args.column], args.country);
    if (!phone) {
      invalid.push({ line: index + 2, value: row[args.column] ?? '(missing)' });
      continue;
    }
    if (seen.has(phone)) continue;
    seen.add(phone);
    queue.push({ to: phone, text: renderTemplate(template, row) });
  }

  const jobName = args.job ?? args.file.split('/').pop().replace(/\.csv$/i, '');
  const logDir = resolve(HERE, 'logs');
  mkdirSync(logDir, { recursive: true });
  const logPath = resolve(logDir, `${jobName}.jsonl`);
  const alreadySent = loadSent(logPath);

  let pending = queue.filter((item) => !alreadySent.has(item.to));
  if (args.limit) pending = pending.slice(0, args.limit);

  const sendWindow = parseWindow(args.window);
  const intervalMs = args.pacing === 'burst' ? 1000 : Math.round(3_600_000 / args.rate);
  const segments = pending.reduce((total, item) => total + segmentCount(item.text), 0);
  const hours = pending.length / args.rate;

  console.log(`\nJob        ${jobName}`);
  console.log(`Provider   ${provider.label}${args.live ? '' : '  (DRY RUN - nothing will be sent)'}`);
  console.log(`Rows       ${rows.length} in CSV`);
  console.log(`Valid      ${queue.length} unique numbers`);
  if (invalid.length > 0) {
    console.log(`Invalid    ${invalid.length} skipped:`);
    for (const bad of invalid.slice(0, 10)) console.log(`             line ${bad.line}: ${bad.value}`);
    if (invalid.length > 10) console.log(`             ...and ${invalid.length - 10} more`);
  }
  if (alreadySent.size > 0) console.log(`Done       ${alreadySent.size} already sent in an earlier run`);
  console.log(`To send    ${pending.length} messages, ${segments} SMS parts`);
  console.log(`Rate       ${args.rate}/hour (${args.pacing}) - about ${hours.toFixed(1)} hours`);
  if (sendWindow) {
    const held = minutesUntilOpen(sendWindow);
    const now = new Date().toTimeString().slice(0, 5);
    console.log(`Window     ${sendWindow.spec} local time (now ${now})${held > 0 ? ` - CLOSED, would hold ${held} min` : ''}`);
  } else {
    console.log('Window     off - sending around the clock (transactional messages only)');
  }
  console.log(`Log        ${logPath}\n`);

  // Promotional SMS in the UAE must carry an opt-out. Warn rather than block:
  // the same script sends transactional messages, where no opt-out belongs.
  const hasOptOut = /stop|unsubscribe|إيقاف|الغاء|إلغاء/i.test(template);
  if (sendWindow && !hasOptOut) {
    console.log('Note       No opt-out wording found in the message. TDRA requires one on');
    console.log('           promotional SMS (e.g. "للإيقاف أرسل STOP"). Ignore for OTP/alerts.\n');
  }

  if (pending.length === 0) {
    console.log('Nothing left to send.\n');
    return;
  }

  if (!args.live) {
    console.log('Sample of what would go out:\n');
    for (const item of pending.slice(0, 3)) {
      const parts = segmentCount(item.text);
      console.log(`  -> ${item.to}  (${parts} part${parts > 1 ? 's' : ''})`);
      console.log(`     ${item.text.replace(/\n/g, '\n     ')}\n`);
    }
    console.log('Add --live to send for real.\n');
    return;
  }

  const missing = provider.requiredEnv.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`${provider.label} needs these in .env: ${missing.join(', ')}`);
  }

  let stopping = false;
  process.on('SIGINT', () => {
    stopping = true;
    console.log('\nStopping after the message in flight. Re-run the same command to resume.');
  });

  let sent = 0;
  let failed = 0;
  const startedAt = Date.now();

  for (const [index, item] of pending.entries()) {
    if (stopping) break;

    // Hold at the edge of the permitted window rather than sending outside it.
    const waitMinutes = minutesUntilOpen(sendWindow);
    if (waitMinutes > 0) {
      const opensAt = new Date(Date.now() + waitMinutes * 60_000).toTimeString().slice(0, 5);
      console.log(`\n  Outside the ${sendWindow.spec} window. Holding ${waitMinutes} min, resuming at ${opensAt}.\n`);
      await sleep(waitMinutes * 60_000);
      if (stopping) break;
    }

    let result;
    for (let attempt = 1; attempt <= args.retries; attempt += 1) {
      result = await provider.send({ to: item.to, text: item.text, env });
      if (result.ok || !result.retryable) break;
      const backoff = 2 ** attempt * 1000;
      console.log(
        `  ${clock()}  ${item.to}  retry ${attempt}/${args.retries} in ${backoff / 1000}s (${result.error ?? result.status})`,
      );
      await sleep(backoff);
    }

    // Record before pacing, so an interrupted run never loses an accepted send.
    appendFileSync(
      logPath,
      `${JSON.stringify({
        to: item.to,
        at: new Date().toISOString(),
        ok: Boolean(result.ok),
        id: result.id,
        error: result.error,
      })}\n`,
    );

    if (result.ok) {
      sent += 1;
      console.log(`  ${clock()}  [ok] ${item.to}  ${sent}/${pending.length}`);
    } else {
      failed += 1;
      console.log(`  ${clock()}  [!!] ${item.to}  ${result.error ?? `HTTP ${result.status}`}`);
    }

    if (index === pending.length - 1 || stopping) break;

    if (args.pacing === 'burst' && (index + 1) % args.rate === 0) {
      const elapsed = Date.now() - startedAt;
      const wait = Math.max(0, 3_600_000 - (elapsed % 3_600_000));
      const resumeAt = new Date(Date.now() + wait).toTimeString().slice(0, 5);
      console.log(`\n  Batch of ${args.rate} done. Next batch at ${resumeAt}.\n`);
      await sleep(wait);
    } else {
      await sleep(intervalMs);
    }
  }

  console.log(`\nSent ${sent}, failed ${failed}, ${pending.length - sent - failed} not attempted.`);
  if (failed > 0) console.log('Failed numbers are logged and will be retried on the next run.');
  console.log('');
}

main().catch((error) => {
  console.error(`\nError: ${error.message}\n`);
  process.exitCode = 1;
});
