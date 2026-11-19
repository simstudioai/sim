import { simApiBroker } from '@/lib/execution/sandbox/brokers/sim-api'
import { defineSandboxTask } from '@/lib/execution/sandbox/define-task'

/** The longest a code-mode program may run; a caller may ask for less. */
export const SIM_API_CODE_MAX_TIMEOUT_MS = 120_000

/** The largest return value, as JSON, a program may hand back: the same bound as one call tool result. */
const SIM_API_CODE_MAX_RESULT_CHARS = 1024 * 1024

/**
 * Console output a program returns, beyond which lines are dropped with a marker.
 * Captured in the isolate rather than read from the worker's stdout so the cap is
 * per run and the logs travel with the result.
 */
const MAX_LOG_CHARS = 64 * 1024

/** Each text field of a failed program's error (message, stack, details as JSON) is cut to this. */
const MAX_ERROR_FIELD_CHARS = 16 * 1024

/**
 * Installs the program's view of Sim: a frozen `sim.api` whose every property
 * is an operation that round-trips through the `simApi` broker, a
 * `SimApiError` for API failures, and a console captured into the result.
 *
 * The program's settlement is recorded through `__simCodeSettle`, which the
 * host-built wrapper calls, and read back by `finalize`. Results and response
 * bodies cross the boundary as JSON text and are parsed on the side that uses
 * them, and an oversized result is refused here, before it crosses. The task
 * installs no `fetch`: the broker is the program's only way out of the isolate.
 */
const BOOTSTRAP = `
  const call = globalThis.__brokers.simApi;
  const MAX_LOG_CHARS = ${MAX_LOG_CHARS};
  const MAX_RESULT_CHARS = ${SIM_API_CODE_MAX_RESULT_CHARS};
  const MAX_ERROR_FIELD_CHARS = ${MAX_ERROR_FIELD_CHARS};
  const cap = (text) =>
    text.length > MAX_ERROR_FIELD_CHARS ? text.slice(0, MAX_ERROR_FIELD_CHARS) + ' [truncated]' : text;
  const logs = [];
  let logChars = 0;
  let logsTruncated = false;
  const format = (value) => {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.stack || String(value);
    try {
      const json = JSON.stringify(value);
      return json === undefined ? String(value) : json;
    } catch {
      return String(value);
    }
  };
  const writer = (prefix) => (...args) => {
    if (logsTruncated) return;
    const line = prefix + args.map(format).join(' ');
    if (logChars + line.length > MAX_LOG_CHARS) {
      logs.push(line.slice(0, Math.max(0, MAX_LOG_CHARS - logChars)), '[logs truncated]');
      logsTruncated = true;
      return;
    }
    logs.push(line);
    logChars += line.length + 1;
  };
  globalThis.console = Object.freeze({
    log: writer(''),
    info: writer(''),
    debug: writer(''),
    warn: writer('WARN: '),
    error: writer('ERROR: '),
  });

  class SimApiError extends Error {
    constructor(info) {
      super(info.message);
      this.name = 'SimApiError';
      this.status = info.status;
      this.code = info.code;
      this.details = info.details;
      this.requestId = info.requestId;
    }
  }

  const api = new Proxy(Object.freeze(Object.create(null)), {
    get(_target, operation) {
      if (typeof operation !== 'string' || operation === 'then') return undefined;
      return async (input) => {
        const answer = await call({ operation, input: input === undefined ? {} : input });
        if (answer.error) throw new SimApiError(answer.error);
        return JSON.parse(answer.dataJson);
      };
    },
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
  });
  const lock = (name, value) =>
    Object.defineProperty(globalThis, name, { value, writable: false, configurable: false });
  lock('sim', Object.freeze({ api }));
  lock('SimApiError', SimApiError);

  const boundedDetails = (details) => {
    if (details === undefined) return undefined;
    let json;
    try {
      json = JSON.stringify(details);
    } catch {
      return undefined;
    }
    return json === undefined || json.length <= MAX_ERROR_FIELD_CHARS ? details : cap(json);
  };
  const describeError = (error) => {
    if (!(error instanceof Error)) return { name: 'Error', message: cap(String(error)) };
    const info = {
      name: cap(String(error.name)),
      message: cap(String(error.message)),
      stack: typeof error.stack === 'string' ? cap(error.stack) : undefined,
    };
    if (error instanceof SimApiError) {
      const { status, code, requestId } = error;
      Object.assign(info, { status, code, requestId, details: boundedDetails(error.details) });
    }
    return info;
  };
  let outcome = null;
  lock('__simCodeSettle', (succeeded, value) => {
    if (outcome) return;
    if (!succeeded) {
      outcome = { ok: false, error: describeError(value) };
      return;
    }
    let resultJson;
    try {
      resultJson = JSON.stringify(value === undefined ? null : value);
      if (resultJson === undefined) throw new TypeError(typeof value + ' has no JSON form');
    } catch (error) {
      outcome = {
        ok: false,
        error: { name: 'TypeError', message: 'The program returned a value that is not JSON-serializable: ' + describeError(error).message },
      };
      return;
    }
    outcome = resultJson.length > MAX_RESULT_CHARS
      ? {
          ok: false,
          error: {
            name: 'RangeError',
            message: 'The returned value is ' + resultJson.length + ' characters; at most ' + MAX_RESULT_CHARS + ' can be returned. Return less, such as counts, ids, or a filtered subset.',
          },
        }
      : { ok: true, resultJson };
  });
  lock('__simCodeOutcomeJson', () => {
    const logsJson = JSON.stringify(logs.join('\\n'));
    if (outcome && outcome.ok) return '{"ok":true,"logs":' + logsJson + ',"result":' + outcome.resultJson + '}';
    const error = outcome ? outcome.error : { name: 'Error', message: 'The program did not finish' };
    return '{"ok":false,"logs":' + logsJson + ',"error":' + JSON.stringify(error) + '}';
  });
`

const FINALIZE = `
  return new TextEncoder().encode(globalThis.__simCodeOutcomeJson());
`

/**
 * A code-mode program from the Sim MCP server: an async function body that
 * calls the v2 API through `sim.api`. Every call is served on the host by the
 * MCP request's own dispatcher, so the program holds no credential and can do
 * only what its caller could do one call at a time.
 */
export const simApiCodeTask = defineSandboxTask({
  id: 'sim-api-code',
  timeoutMs: SIM_API_CODE_MAX_TIMEOUT_MS,
  bundles: [],
  brokers: [simApiBroker],
  bootstrap: BOOTSTRAP,
  finalize: FINALIZE,
  toResult: (bytes) => Buffer.from(bytes),
})
