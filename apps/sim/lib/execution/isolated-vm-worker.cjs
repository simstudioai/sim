/**
 * Node.js worker for isolated-vm execution.
 * Runs in a separate Node.js process, communicates with parent via IPC.
 */

const ivm = require('isolated-vm')

const USER_CODE_START_LINE = 4
const pendingFetches = new Map()
let fetchIdCounter = 0
const FETCH_TIMEOUT_MS = 300000 // 5 minutes
const MAX_STDOUT_CHARS = Number.parseInt(process.env.IVM_MAX_STDOUT_CHARS || '', 10) || 200000
const MAX_FETCH_OPTIONS_JSON_CHARS =
  Number.parseInt(process.env.IVM_MAX_FETCH_OPTIONS_JSON_CHARS || '', 10) || 256 * 1024

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
async function executeCode(request) {
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

  try {
    isolate = new ivm.Isolate({ memoryLimit: 128 })
    const context = await isolate.createContext()
    const jail = context.global

    await jail.set('global', jail.derefInto())

    const logCallback = new ivm.Callback((...args) => {
      const message = args.map((arg) => stringifyLogValue(arg)).join(' ')
      appendStdout(`${message}\n`)
    })
    await jail.set('__log', logCallback)

    const errorCallback = new ivm.Callback((...args) => {
      const message = args.map((arg) => stringifyLogValue(arg)).join(' ')
      appendStdout(`ERROR: ${message}\n`)
    })
    await jail.set('__error', errorCallback)

    await jail.set('params', new ivm.ExternalCopy(params).copyInto())
    await jail.set('environmentVariables', new ivm.ExternalCopy(envVars).copyInto())

    for (const [key, value] of Object.entries(contextVariables)) {
      if (value === undefined) {
        await jail.set(key, undefined)
      } else if (value === null) {
        await jail.set(key, null)
      } else {
        await jail.set(key, new ivm.ExternalCopy(value).copyInto())
      }
    }

    const fetchCallback = new ivm.Reference(async (url, optionsJson) => {
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

        if (result.error) {
          throw new Error(result.error);
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

    const bootstrapScript = await isolate.compileScript(bootstrap)
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

    const userScript = await isolate.compileScript(wrappedCode, { filename: 'user-function.js' })
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
    if (isolate) {
      isolate.dispose()
    }
  }
}

process.on('message', async (msg) => {
  try {
    if (msg.type === 'execute') {
      const result = await executeCode(msg.request)
      if (process.send && process.connected) {
        process.send({ type: 'result', executionId: msg.executionId, result })
      }
    } else if (msg.type === 'fetchResponse') {
      const pending = pendingFetches.get(msg.fetchId)
      if (pending) {
        clearTimeout(pending.timeout)
        pendingFetches.delete(msg.fetchId)
        pending.resolve(msg.response)
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
