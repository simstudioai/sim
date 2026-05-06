/**
 * Node.js worker for isolated-vm execution.
 * Runs in a separate Node.js process, communicates with parent via IPC.
 */

const ivm = require('isolated-vm')
const fs = require('node:fs')
const path = require('node:path')

const USER_CODE_START_LINE = 4
const pendingFetches = new Map()
let fetchIdCounter = 0
const pendingBrokerCalls = new Map()
let brokerIdCounter = 0
const FETCH_TIMEOUT_MS = 300000 // 5 minutes
const BROKER_TIMEOUT_MS = 300000
const MAX_STDOUT_CHARS = Number.parseInt(process.env.IVM_MAX_STDOUT_CHARS || '', 10) || 200000
const MAX_FETCH_OPTIONS_JSON_CHARS =
  Number.parseInt(process.env.IVM_MAX_FETCH_OPTIONS_JSON_CHARS || '', 10) || 256 * 1024

const SANDBOX_BUNDLE_DIR = path.join(__dirname, 'sandbox', 'bundles')
const SANDBOX_BUNDLE_FILES = {
  pptxgenjs: 'pptxgenjs.cjs',
  docx: 'docx.cjs',
  'pdf-lib': 'pdf-lib.cjs',
}
const bundleSourceCache = new Map()
const activeIsolates = new Map()

function getBundleSource(bundleName) {
  const cached = bundleSourceCache.get(bundleName)
  if (cached) return cached
  const fileName = SANDBOX_BUNDLE_FILES[bundleName]
  if (!fileName) {
    throw new Error(`Unknown sandbox bundle: ${bundleName}`)
  }
  const bundlePath = path.join(SANDBOX_BUNDLE_DIR, fileName)
  if (!fs.existsSync(bundlePath)) {
    throw new Error(
      `Sandbox bundle not found at ${bundlePath}. Run \`bun run build:sandbox-bundles\`.`
    )
  }
  const source = fs.readFileSync(bundlePath, 'utf-8')
  bundleSourceCache.set(bundleName, { source, fileName })
  return bundleSourceCache.get(bundleName)
}

function stringifyLogValue(value) {
  if (typeof value !== 'object' || value === null) {
    return String(value)
  }

  try {
    return JSON.stringify(value)
  } catch {
    return '[unserializable]'
  }
}

/**
 * Extract line and column from error stack or message
 */
function extractLineInfo(errorMessage, stack) {
  if (stack) {
    const stackMatch = stack.match(/(?:<isolated-vm>|user-function\.js):(\d+):(\d+)/)
    if (stackMatch) {
      return {
        line: Number.parseInt(stackMatch[1], 10),
        column: Number.parseInt(stackMatch[2], 10),
      }
    }
    const atMatch = stack.match(/at\s+(?:<isolated-vm>|user-function\.js):(\d+):(\d+)/)
    if (atMatch) {
      return {
        line: Number.parseInt(atMatch[1], 10),
        column: Number.parseInt(atMatch[2], 10),
      }
    }
  }

  const msgMatch = errorMessage.match(/:(\d+):(\d+)/)
  if (msgMatch) {
    return {
      line: Number.parseInt(msgMatch[1], 10),
      column: Number.parseInt(msgMatch[2], 10),
    }
  }

  return {}
}

/**
 * Convert isolated-vm error info to a format compatible with the route's error handling
 */
function convertToCompatibleError(errorInfo, userCode) {
  const { name } = errorInfo
  let { message, stack } = errorInfo

  message = message
    .replace(/\s*\[user-function\.js:\d+:\d+\]/g, '')
    .replace(/\s*\[<isolated-vm>:\d+:\d+\]/g, '')
    .replace(/\s*\(<isolated-vm>:\d+:\d+\)/g, '')
    .trim()

  const lineInfo = extractLineInfo(errorInfo.message, stack)

  let userLine
  let lineContent

  if (lineInfo.line !== undefined) {
    userLine = lineInfo.line - USER_CODE_START_LINE
    const codeLines = userCode.split('\n')
    if (userLine > 0 && userLine <= codeLines.length) {
      lineContent = codeLines[userLine - 1]?.trim()
    } else if (userLine <= 0) {
      userLine = 1
      lineContent = codeLines[0]?.trim()
    } else {
      userLine = codeLines.length
      lineContent = codeLines[codeLines.length - 1]?.trim()
    }
  }

  if (stack) {
    stack = stack.replace(/<isolated-vm>:(\d+):(\d+)/g, (_, line, col) => {
      const adjustedLine = Number.parseInt(line, 10) - USER_CODE_START_LINE
      return `user-function.js:${Math.max(1, adjustedLine)}:${col}`
    })
    stack = stack.replace(/at <isolated-vm>:(\d+):(\d+)/g, (_, line, col) => {
      const adjustedLine = Number.parseInt(line, 10) - USER_CODE_START_LINE
      return `at user-function.js:${Math.max(1, adjustedLine)}:${col}`
    })
  }

  return {
    message,
    name,
    stack,
    line: userLine,
    column: lineInfo.column,
    lineContent,
  }
}

/**
 * Execute code in isolated-vm
 */
async function executeCode(request, executionId) {
  const { code, params, envVars, contextVariables, timeoutMs, requestId } = request
  const stdoutChunks = []
  let stdoutLength = 0
  let stdoutTruncated = false
  let isolate = null

  const appendStdout = (line) => {
    if (stdoutTruncated || !line) return

    const remaining = MAX_STDOUT_CHARS - stdoutLength
    if (remaining <= 0) {
      stdoutTruncated = true
      stdoutChunks.push('[stdout truncated]\n')
      return
    }

    if (line.length <= remaining) {
      stdoutChunks.push(line)
      stdoutLength += line.length
      return
    }

    stdoutChunks.push(line.slice(0, remaining))
    stdoutChunks.push('\n[stdout truncated]\n')
    stdoutLength = MAX_STDOUT_CHARS
    stdoutTruncated = true
  }

  let context = null
  let bootstrapScript = null
  let userScript = null
  let logCallback = null
  let errorCallback = null
  let fetchCallback = null
  const externalCopies = []

  try {
    isolate = new ivm.Isolate({ memoryLimit: 128 })
    if (executionId !== undefined) activeIsolates.set(executionId, isolate)
    context = await isolate.createContext()
    const jail = context.global

    await jail.set('global', jail.derefInto())

    logCallback = new ivm.Callback((...args) => {
      const message = args.map((arg) => stringifyLogValue(arg)).join(' ')
      appendStdout(`${message}\n`)
    })
    await jail.set('__log', logCallback)

    errorCallback = new ivm.Callback((...args) => {
      const message = args.map((arg) => stringifyLogValue(arg)).join(' ')
      appendStdout(`ERROR: ${message}\n`)
    })
    await jail.set('__error', errorCallback)

    const paramsCopy = new ivm.ExternalCopy(params)
    externalCopies.push(paramsCopy)
    await jail.set('params', paramsCopy.copyInto())

    const envVarsCopy = new ivm.ExternalCopy(envVars)
    externalCopies.push(envVarsCopy)
    await jail.set('environmentVariables', envVarsCopy.copyInto())

    for (const [key, value] of Object.entries(contextVariables)) {
      if (value === undefined) {
        await jail.set(key, undefined)
      } else if (value === null) {
        await jail.set(key, null)
      } else {
        const ctxCopy = new ivm.ExternalCopy(value)
        externalCopies.push(ctxCopy)
        await jail.set(key, ctxCopy.copyInto())
      }
    }

    fetchCallback = new ivm.Reference(async (url, optionsJson) => {
      return new Promise((resolve) => {
        const fetchId = ++fetchIdCounter
        const timeout = setTimeout(() => {
          if (pendingFetches.has(fetchId)) {
            pendingFetches.delete(fetchId)
            resolve(JSON.stringify({ error: 'Fetch request timed out' }))
          }
        }, FETCH_TIMEOUT_MS)
        pendingFetches.set(fetchId, { resolve, timeout })
        if (process.send && process.connected) {
          process.send({ type: 'fetch', fetchId, requestId, url, optionsJson })
        } else {
          clearTimeout(timeout)
          pendingFetches.delete(fetchId)
          resolve(JSON.stringify({ error: 'Parent process disconnected' }))
        }
      })
    })
    await jail.set('__fetchRef', fetchCallback)

    const bootstrap = `
      // Set up console object
      const console = {
        log: (...args) => __log(...args),
        error: (...args) => __error(...args),
        warn: (...args) => __log('WARN:', ...args),
        info: (...args) => __log(...args),
      };

      // Set up fetch function that uses the host's secure fetch
      async function fetch(url, options) {
        let optionsJson;
        if (options) {
          try {
            optionsJson = JSON.stringify(options);
          } catch {
            throw new Error('fetch options must be JSON-serializable');
          }
          if (optionsJson.length > ${MAX_FETCH_OPTIONS_JSON_CHARS}) {
            throw new Error('fetch options exceed maximum payload size');
          }
        }
        const resultJson = await __fetchRef.apply(undefined, [url, optionsJson], { result: { promise: true } });
        let result;
        try {
          result = JSON.parse(resultJson);
        } catch {
          throw new Error('Invalid fetch response');
        }

        if (typeof result.error === 'string') {
          throw new Error(result.error || 'Fetch failed');
        }

        // Create a Response-like object
        return {
          ok: result.ok,
          status: result.status,
          statusText: result.statusText,
          headers: {
            get: (name) => result.headers[name.toLowerCase()] || null,
            entries: () => Object.entries(result.headers),
          },
          text: async () => result.body,
          json: async () => {
            try {
              return JSON.parse(result.body);
            } catch (e) {
              throw new Error('Failed to parse response as JSON: ' + e.message);
            }
          },
          blob: async () => { throw new Error('blob() not supported in sandbox'); },
          arrayBuffer: async () => { throw new Error('arrayBuffer() not supported in sandbox'); },
        };
      }

      // Prevent access to dangerous globals with stronger protection
      const undefined_globals = [
        'Isolate', 'Context', 'Script', 'Module', 'Callback', 'Reference',
        'ExternalCopy', 'process', 'require', 'module', 'exports', '__dirname', '__filename'
      ];
      for (const name of undefined_globals) {
        try {
          Object.defineProperty(global, name, {
            value: undefined,
            writable: false,
            configurable: false
          });
        } catch {}
      }
    `

    bootstrapScript = await isolate.compileScript(bootstrap)
    await bootstrapScript.run(context)

    const wrappedCode = `
      (async () => {
        try {
          const __userResult = await (async () => {
            ${code}
          })();
          return JSON.stringify({ success: true, result: __userResult });
        } catch (error) {
          // Capture full error details including stack trace
          const errorInfo = {
            message: error.message || String(error),
            name: error.name || 'Error',
            stack: error.stack || ''
          };
          console.error(error.stack || error.message || error);
          return JSON.stringify({ success: false, errorInfo });
        }
      })()
    `

    userScript = await isolate.compileScript(wrappedCode, { filename: 'user-function.js' })
    const resultJson = await userScript.run(context, { timeout: timeoutMs, promise: true })

    let result = null
    let error

    if (typeof resultJson === 'string') {
      try {
        const parsed = JSON.parse(resultJson)
        if (parsed.success) {
          result = parsed.result
        } else if (parsed.errorInfo) {
          error = convertToCompatibleError(parsed.errorInfo, code)
        } else {
          error = { message: 'Unknown error', name: 'Error' }
        }
      } catch {
        result = resultJson
      }
    }

    const stdout = stdoutChunks.join('')

    if (error) {
      return { result: null, stdout, error }
    }

    return { result, stdout }
  } catch (err) {
    const stdout = stdoutChunks.join('')

    if (err instanceof Error) {
      const errorInfo = {
        message: err.message,
        name: err.name,
        stack: err.stack,
      }

      // Host sent a `cancel` IPC which called `isolate.dispose()`. Any
      // in-flight compileScript/run then throws; detect that authoritatively
      // via the isolate flag rather than fuzzy-matching the error message.
      if (isolate?.isDisposed) {
        return {
          result: null,
          stdout,
          error: { message: 'Execution cancelled', name: 'AbortError' },
        }
      }

      if (err.message.includes('Script execution timed out')) {
        return {
          result: null,
          stdout,
          error: {
            message: `Execution timed out after ${timeoutMs}ms`,
            name: 'TimeoutError',
          },
        }
      }

      return {
        result: null,
        stdout,
        error: convertToCompatibleError(errorInfo, code),
      }
    }

    return {
      result: null,
      stdout,
      error: {
        message: String(err),
        name: 'Error',
        line: 1,
        lineContent: code.split('\n')[0]?.trim(),
      },
    }
  } finally {
    const releaseables = [
      userScript,
      bootstrapScript,
      ...externalCopies,
      fetchCallback,
      errorCallback,
      logCallback,
      context,
    ]
    for (const obj of releaseables) {
      if (obj) {
        try {
          obj.release()
        } catch {}
      }
    }
    if (isolate) {
      try {
        isolate.dispose()
      } catch {}
    }
    if (executionId !== undefined) activeIsolates.delete(executionId)
  }
}

/**
 * Task-mode execution. Loads pre-built library bundles into the isolate,
 * exposes host-side brokers as isolate globals under `__brokers.<name>(args)`,
 * runs the task bootstrap (which installs friendly names on globalThis),
 * executes user code, then runs `finalize` (must return a Uint8Array). The
 * resulting bytes are returned as base64 in `bytesBase64`.
 */
async function executeTask(request, executionId) {
  const { code, timeoutMs, task } = request
  const stdoutChunks = []
  let stdoutLength = 0
  let stdoutTruncated = false
  let isolate = null

  const appendStdout = (line) => {
    if (stdoutTruncated || !line) return
    const remaining = MAX_STDOUT_CHARS - stdoutLength
    if (remaining <= 0) {
      stdoutTruncated = true
      stdoutChunks.push('[stdout truncated]\n')
      return
    }
    if (line.length <= remaining) {
      stdoutChunks.push(line)
      stdoutLength += line.length
      return
    }
    stdoutChunks.push(line.slice(0, remaining))
    stdoutChunks.push('\n[stdout truncated]\n')
    stdoutLength = MAX_STDOUT_CHARS
    stdoutTruncated = true
  }

  let context = null
  const releaseables = []

  // Timer bookkeeping — hoisted out of the try so the finally can always
  // sweep regardless of where execution throws.
  let nextTimerId = 1
  const timers = new Map()
  const cleanupTimers = () => {
    for (const entry of timers.values()) {
      try {
        if (entry.recurring) clearInterval(entry.nodeTimer)
        else clearTimeout(entry.nodeTimer)
      } catch {}
      try {
        entry.fnRef.release()
      } catch {}
    }
    timers.clear()
  }

  // Phase timings (ms). Populated inline during execution; returned in
  // every result shape so the host can log where time is spent per request.
  const timings = {
    setup: 0,
    runtimeBootstrap: 0,
    bundles: 0,
    brokerInstall: 0,
    taskBootstrap: 0,
    harden: 0,
    userCode: 0,
    finalize: 0,
    total: 0,
  }
  const tStart = Date.now()
  let tPhase = tStart

  try {
    isolate = new ivm.Isolate({ memoryLimit: 128 })
    if (executionId !== undefined) activeIsolates.set(executionId, isolate)
    context = await isolate.createContext()
    const jail = context.global

    await jail.set('global', jail.derefInto())

    const logCallback = new ivm.Callback((...args) => {
      const message = args.map((arg) => stringifyLogValue(arg)).join(' ')
      appendStdout(`${message}\n`)
    })
    releaseables.push(logCallback)
    await jail.set('__log', logCallback)

    const errorCallback = new ivm.Callback((...args) => {
      const message = args.map((arg) => stringifyLogValue(arg)).join(' ')
      appendStdout(`ERROR: ${message}\n`)
    })
    releaseables.push(errorCallback)
    await jail.set('__error', errorCallback)

    // Delegate TextEncoder / TextDecoder to Node's native implementations
    // (C++-backed, WHATWG-compliant). The isolate-side classes installed in
    // the runtime bootstrap below call into these via closure-captured refs
    // so hardening can safely undefine the raw globals afterwards.
    const nodeEncoder = new TextEncoder()
    const nodeDecoder = new TextDecoder()
    const textEncodeCallback = new ivm.Callback((str) =>
      nodeEncoder.encode(typeof str === 'string' ? str : String(str ?? ''))
    )
    releaseables.push(textEncodeCallback)
    await jail.set('__textEncode', textEncodeCallback)

    const textDecodeCallback = new ivm.Callback((bytes) => {
      if (!bytes) return ''
      return nodeDecoder.decode(bytes)
    })
    releaseables.push(textDecodeCallback)
    await jail.set('__textDecode', textDecodeCallback)

    // Delegate timers to Node's real timer heap via ivm.Reference (the pattern
    // recommended by laverdet/isolated-vm#136). Host-side bookkeeping was
    // hoisted to the function scope above so the finally can always sweep.
    //
    // Note on arg marshaling: we call the reference with
    // `arguments: { reference: true }` from the isolate so the function arg
    // crosses as a Reference (functions aren't transferable by default).
    // That option applies uniformly, so primitive args (ms, id) also arrive
    // as `Reference<primitive>`. The `unwrapPrimitive` helper calls
    // `.copySync()` to get the real value. Numbers/strings/booleans are
    // supported; anything exotic falls back to `undefined`.
    const unwrapPrimitive = (v) => {
      if (v === null || v === undefined) return v
      const t = typeof v
      if (t === 'number' || t === 'string' || t === 'boolean') return v
      if (v && typeof v.copySync === 'function') {
        try {
          return v.copySync()
        } catch {
          return undefined
        }
      }
      return v
    }

    const setTimeoutRef = new ivm.Reference((fnRef, msRef) => {
      const id = nextTimerId++
      const delay = Math.max(0, Math.min(Number(unwrapPrimitive(msRef)) || 0, timeoutMs))
      const nodeTimer = setTimeout(() => {
        const entry = timers.get(id)
        if (!entry) return
        timers.delete(id)
        try {
          fnRef.applyIgnored(undefined, [], { timeout: timeoutMs })
        } catch {
          // isolate disposed between schedule and fire — callback silently dropped
        }
        try {
          fnRef.release()
        } catch {}
      }, delay)
      timers.set(id, { nodeTimer, fnRef, recurring: false })
      return id
    })
    releaseables.push(setTimeoutRef)
    await jail.set('__setTimeoutRef', setTimeoutRef)

    const clearTimeoutRef = new ivm.Reference((idRef) => {
      const key = Number(unwrapPrimitive(idRef))
      if (!Number.isFinite(key)) return
      const entry = timers.get(key)
      if (!entry) return
      try {
        if (entry.recurring) clearInterval(entry.nodeTimer)
        else clearTimeout(entry.nodeTimer)
      } catch {}
      try {
        entry.fnRef.release()
      } catch {}
      timers.delete(key)
    })
    releaseables.push(clearTimeoutRef)
    await jail.set('__clearTimeoutRef', clearTimeoutRef)

    const setIntervalRef = new ivm.Reference((fnRef, msRef) => {
      const id = nextTimerId++
      const delay = Math.max(1, Math.min(Number(unwrapPrimitive(msRef)) || 1, timeoutMs))
      const nodeTimer = setInterval(() => {
        const entry = timers.get(id)
        if (!entry) return
        try {
          fnRef.applyIgnored(undefined, [], { timeout: timeoutMs })
        } catch {
          // isolate disposed — callback silently dropped; the sweep on dispose
          // clears the Node interval and releases the fn ref.
        }
      }, delay)
      timers.set(id, { nodeTimer, fnRef, recurring: true })
      return id
    })
    releaseables.push(setIntervalRef)
    await jail.set('__setIntervalRef', setIntervalRef)

    const brokerRef = new ivm.Reference(async (brokerName, argsJson) => {
      return new Promise((resolve) => {
        const brokerId = ++brokerIdCounter
        const timeout = setTimeout(() => {
          if (pendingBrokerCalls.has(brokerId)) {
            pendingBrokerCalls.delete(brokerId)
            resolve(JSON.stringify({ error: `Broker "${brokerName}" timed out` }))
          }
        }, BROKER_TIMEOUT_MS)
        pendingBrokerCalls.set(brokerId, { resolve, timeout, executionId })
        if (process.send && process.connected) {
          process.send({ type: 'broker', brokerId, executionId, brokerName, argsJson })
        } else {
          clearTimeout(timeout)
          pendingBrokerCalls.delete(brokerId)
          resolve(JSON.stringify({ error: 'Parent process disconnected' }))
        }
      })
    })
    releaseables.push(brokerRef)
    await jail.set('__brokerRef', brokerRef)

    const runtimeBootstrap = `
      // Capture every host bridge in a closure so later hardening can unset
      // the raw globals without breaking the runtime surface user code
      // depends on.
      (() => {
        const __log = globalThis.__log;
        const __error = globalThis.__error;
        const __textEncode = globalThis.__textEncode;
        const __textDecode = globalThis.__textDecode;
        const __setTimeoutRef = globalThis.__setTimeoutRef;
        const __clearTimeoutRef = globalThis.__clearTimeoutRef;
        const __setIntervalRef = globalThis.__setIntervalRef;

        globalThis.console = {
          log: (...args) => __log(...args),
          error: (...args) => __error(...args),
          warn: (...args) => __log('WARN:', ...args),
          info: (...args) => __log(...args),
          debug: (...args) => __log(...args),
        };

        // TextEncoder / TextDecoder delegate to Node's native implementations
        // via ivm.Callback bridges. UTF-8 only — that's all the doc libraries
        // need. If a library passes an alternate label to TextDecoder, the
        // bridge still decodes as UTF-8; \`encoding\` getter returns the label
        // for parity with the spec's getter behaviour.
        globalThis.TextEncoder = class TextEncoder {
          get encoding() { return 'utf-8' }
          encode(input) {
            return __textEncode(input == null ? '' : String(input));
          }
        };
        globalThis.TextDecoder = class TextDecoder {
          constructor(label) { this._label = (label || 'utf-8').toLowerCase(); }
          get encoding() { return this._label; }
          decode(input) {
            if (!input) return '';
            const bytes = input instanceof Uint8Array
              ? input
              : ArrayBuffer.isView(input)
                ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
                : new Uint8Array(input);
            return __textDecode(bytes);
          }
        };

        // setTimeout / setInterval delegate to Node's real timer heap via
        // ivm.Reference. The \`ms\` arg is honored (host clamps to the script
        // timeout window); \`clearTimeout\` / \`clearInterval\` actually cancel.
        // All outstanding timers are swept on isolate dispose.
        globalThis.setTimeout = function(fn, ms) {
          if (typeof fn !== 'function') {
            throw new TypeError('setTimeout requires a function callback');
          }
          return __setTimeoutRef.applySync(undefined, [fn, ms], {
            arguments: { reference: true },
          });
        };
        globalThis.clearTimeout = function(id) {
          if (id == null) return;
          __clearTimeoutRef.applyIgnored(undefined, [id], {
            arguments: { reference: true },
          });
        };
        globalThis.setImmediate = function(fn) {
          return globalThis.setTimeout(fn, 0);
        };
        globalThis.clearImmediate = globalThis.clearTimeout;
        globalThis.setInterval = function(fn, ms) {
          if (typeof fn !== 'function') {
            throw new TypeError('setInterval requires a function callback');
          }
          return __setIntervalRef.applySync(undefined, [fn, ms], {
            arguments: { reference: true },
          });
        };
        globalThis.clearInterval = globalThis.clearTimeout;
        // queueMicrotask is V8-intrinsic in modern isolates; provide a
        // defensive fallback for older V8 builds.
        if (typeof globalThis.queueMicrotask === 'undefined') {
          globalThis.queueMicrotask = function(fn) { Promise.resolve().then(fn); };
        }
      })();
    `
    timings.setup = Date.now() - tPhase
    tPhase = Date.now()

    const runtimeScript = await isolate.compileScript(runtimeBootstrap)
    releaseables.push(runtimeScript)
    await runtimeScript.run(context)
    timings.runtimeBootstrap = Date.now() - tPhase
    tPhase = Date.now()

    for (const bundleName of task.bundles) {
      const { source, fileName } = getBundleSource(bundleName)
      const bundleScript = await isolate.compileScript(source, { filename: `sandbox/${fileName}` })
      releaseables.push(bundleScript)
      await bundleScript.run(context, { timeout: timeoutMs })
    }
    timings.bundles = Date.now() - tPhase
    tPhase = Date.now()

    const brokerNamesJson = JSON.stringify(task.brokers)
    const brokerInstallScript = `
      (() => {
        // Capture the bridge reference in a closure so hardening can unset the
        // global without breaking already-installed brokers.
        const __ref = globalThis.__brokerRef;
        globalThis.__brokers = globalThis.__brokers || {};
        for (const name of ${brokerNamesJson}) {
          globalThis.__brokers[name] = async (args) => {
            const argsJson = args === undefined ? undefined : JSON.stringify(args);
            const responseJson = await __ref.apply(
              undefined,
              [name, argsJson],
              { result: { promise: true } }
            );
            let response;
            try { response = JSON.parse(responseJson); } catch { throw new Error('Invalid broker response'); }
            if (typeof response.error === 'string') {
              throw new Error(response.error || 'Broker call failed');
            }
            return response.resultJson === undefined || response.resultJson === null
              ? null
              : JSON.parse(response.resultJson);
          };
        }
      })();
    `
    const brokerScript = await isolate.compileScript(brokerInstallScript)
    releaseables.push(brokerScript)
    await brokerScript.run(context)
    timings.brokerInstall = Date.now() - tPhase
    tPhase = Date.now()

    const bootstrapScript = await isolate.compileScript(`(async () => { ${task.bootstrap} })()`, {
      filename: `sandbox/${task.id}/bootstrap.js`,
    })
    releaseables.push(bootstrapScript)
    await bootstrapScript.run(context, { timeout: timeoutMs, promise: true })
    timings.taskBootstrap = Date.now() - tPhase
    tPhase = Date.now()

    const hardenScript = await isolate.compileScript(`
      // Remove host-provided bridges + isolated-vm escape globals before user
      // code runs. Leave the library polyfills (Buffer, process, etc.) alone —
      // bundles have already captured what they need and user code calling into
      // them would break if we stripped these.
      const undefined_globals = [
        'Isolate', 'Context', 'Script', 'Module', 'Callback', 'Reference',
        'ExternalCopy', '__dirname', '__filename', '__brokerRef',
        '__log', '__error', '__textEncode', '__textDecode',
        '__setTimeoutRef', '__clearTimeoutRef', '__setIntervalRef'
      ];
      for (const name of undefined_globals) {
        try {
          Object.defineProperty(globalThis, name, {
            value: undefined, writable: false, configurable: false
          });
        } catch {}
      }
    `)
    releaseables.push(hardenScript)
    await hardenScript.run(context)
    timings.harden = Date.now() - tPhase
    tPhase = Date.now()

    const wrappedUserCode = `
      (async () => {
        try {
          await (async () => {
            ${code}
          })();
          return JSON.stringify({ success: true });
        } catch (error) {
          return JSON.stringify({
            success: false,
            errorInfo: {
              message: error && error.message ? error.message : String(error),
              name: error && error.name ? error.name : 'Error',
              stack: error && error.stack ? error.stack : '',
            },
          });
        }
      })()
    `
    const userScript = await isolate.compileScript(wrappedUserCode, {
      filename: 'user-function.js',
    })
    releaseables.push(userScript)
    const userResultJson = await userScript.run(context, { timeout: timeoutMs, promise: true })
    timings.userCode = Date.now() - tPhase
    tPhase = Date.now()

    let userResult
    try {
      userResult = JSON.parse(userResultJson)
    } catch {
      userResult = { success: false, errorInfo: { message: 'Invalid user result', name: 'Error' } }
    }

    if (!userResult.success) {
      timings.total = Date.now() - tStart
      return {
        result: null,
        stdout: stdoutChunks.join(''),
        error: convertToCompatibleError(userResult.errorInfo, code),
        timings,
      }
    }

    const finalizeWrapped = `
      (async () => {
        const __bytes = await (async () => {
          ${task.finalize}
        })();
        if (!__bytes) {
          throw new Error('Task finalize returned nothing; expected a Uint8Array');
        }
        const __u8 = __bytes instanceof Uint8Array
          ? __bytes
          : ArrayBuffer.isView(__bytes)
            ? new Uint8Array(__bytes.buffer, __bytes.byteOffset, __bytes.byteLength)
            : new Uint8Array(__bytes);
        // Inline base64 encoding (no Buffer dep; works even if polyfill stripped).
        const __alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        let __out = '';
        const __len = __u8.length;
        for (let __i = 0; __i < __len; __i += 3) {
          const __b0 = __u8[__i];
          const __b1 = __i + 1 < __len ? __u8[__i + 1] : 0;
          const __b2 = __i + 2 < __len ? __u8[__i + 2] : 0;
          __out += __alphabet[__b0 >> 2];
          __out += __alphabet[((__b0 & 0x03) << 4) | (__b1 >> 4)];
          __out += __i + 1 < __len ? __alphabet[((__b1 & 0x0f) << 2) | (__b2 >> 6)] : '=';
          __out += __i + 2 < __len ? __alphabet[__b2 & 0x3f] : '=';
        }
        return __out;
      })()
    `
    const finalizeScript = await isolate.compileScript(finalizeWrapped, {
      filename: `sandbox/${task.id}/finalize.js`,
    })
    releaseables.push(finalizeScript)
    const bytesBase64 = await finalizeScript.run(context, { timeout: timeoutMs, promise: true })
    timings.finalize = Date.now() - tPhase
    timings.total = Date.now() - tStart

    return {
      result: null,
      stdout: stdoutChunks.join(''),
      bytesBase64,
      timings,
    }
  } catch (err) {
    const stdout = stdoutChunks.join('')
    timings.total = Date.now() - tStart
    if (err instanceof Error) {
      const errorInfo = { message: err.message, name: err.name, stack: err.stack }
      // Cancellation: host sent `cancel` IPC which called `isolate.dispose()`.
      // Detect authoritatively via the isolate flag so we don't depend on
      // isolated-vm's internal error wording.
      if (isolate?.isDisposed) {
        return {
          result: null,
          stdout,
          error: { message: 'Execution cancelled', name: 'AbortError' },
          timings,
        }
      }
      if (err.message?.includes('Script execution timed out')) {
        return {
          result: null,
          stdout,
          error: {
            message: `Execution timed out after ${timeoutMs}ms`,
            name: 'TimeoutError',
          },
          timings,
        }
      }
      return {
        result: null,
        stdout,
        error: convertToCompatibleError(errorInfo, code),
        timings,
      }
    }
    return {
      result: null,
      stdout,
      error: { message: String(err), name: 'Error' },
      timings,
    }
  } finally {
    // Sweep pending timers BEFORE releasing the isolate-side references they
    // hold. This cancels any scheduled Node timers and releases the fn refs
    // so callbacks can't fire after dispose.
    cleanupTimers()
    for (const obj of releaseables) {
      if (obj) {
        try {
          obj.release()
        } catch {}
      }
    }
    if (context) {
      try {
        context.release()
      } catch {}
    }
    if (isolate) {
      try {
        isolate.dispose()
      } catch {}
    }
    if (executionId !== undefined) activeIsolates.delete(executionId)
  }
}

process.on('message', async (msg) => {
  try {
    if (msg.type === 'execute') {
      const result = msg.request.task
        ? await executeTask(msg.request, msg.executionId)
        : await executeCode(msg.request, msg.executionId)
      if (process.send && process.connected) {
        process.send({ type: 'result', executionId: msg.executionId, result })
      }
    } else if (msg.type === 'cancel') {
      // Host asked us to abort this execution. Disposing the isolate causes
      // the in-flight compileScript/run to throw; the surrounding try/catch
      // in execute{Code,Task} detects `isolate.isDisposed` and converts that
      // into an AbortError result, which the host still processes for cleanup.
      const iso = activeIsolates.get(msg.executionId)
      if (iso) {
        try {
          iso.dispose()
        } catch {}
      }
      // Release any pending broker-call bookkeeping tied to this execution
      // so its timers + Map entries don't linger up to BROKER_TIMEOUT_MS.
      for (const [brokerId, pending] of pendingBrokerCalls) {
        if (pending.executionId === msg.executionId) {
          clearTimeout(pending.timeout)
          pendingBrokerCalls.delete(brokerId)
          pending.resolve(JSON.stringify({ error: 'Execution cancelled' }))
        }
      }
    } else if (msg.type === 'fetchResponse') {
      const pending = pendingFetches.get(msg.fetchId)
      if (pending) {
        clearTimeout(pending.timeout)
        pendingFetches.delete(msg.fetchId)
        pending.resolve(msg.response)
      }
    } else if (msg.type === 'brokerResponse') {
      const pending = pendingBrokerCalls.get(msg.brokerId)
      if (pending) {
        clearTimeout(pending.timeout)
        pendingBrokerCalls.delete(msg.brokerId)
        pending.resolve(JSON.stringify({ error: msg.error, resultJson: msg.resultJson }))
      }
    }
  } catch (err) {
    if (msg.type === 'execute' && process.send && process.connected) {
      process.send({
        type: 'result',
        executionId: msg.executionId,
        result: {
          result: null,
          stdout: '',
          error: {
            message: err instanceof Error ? err.message : 'Worker error',
            name: 'WorkerError',
          },
        },
      })
    }
  }
})

if (process.send) {
  process.send({ type: 'ready' })
}
