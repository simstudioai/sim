import ivm from 'isolated-vm'
import { validateProxyUrl } from '@/lib/core/security/input-validation'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('IsolatedVMExecution')

export interface IsolatedVMExecutionRequest {
  code: string
  params: Record<string, unknown>
  envVars: Record<string, string>
  contextVariables: Record<string, unknown>
  timeoutMs: number
  requestId: string
  userCodeStartLine: number
}

export interface IsolatedVMExecutionResult {
  result: unknown
  stdout: string
  error?: IsolatedVMError
}

export interface IsolatedVMError {
  message: string
  name: string
  stack?: string
}

/**
 * Secure fetch wrapper that validates URLs to prevent SSRF attacks
 */
async function secureFetch(
  requestId: string,
  url: string,
  options?: RequestInit
): Promise<{
  ok: boolean
  status: number
  statusText: string
  body: string
  headers: Record<string, string>
}> {
  const validation = validateProxyUrl(url)
  if (!validation.isValid) {
    logger.warn(`[${requestId}] Blocked fetch request due to SSRF validation`, {
      url: url.substring(0, 100),
      error: validation.error,
    })
    throw new Error(`Security Error: ${validation.error}`)
  }

  const response = await fetch(url, options)
  const body = await response.text()
  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    headers[key] = value
  })

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    body,
    headers,
  }
}

/**
 * Convert isolated-vm error info to a format compatible with the route's error handling
 */
function convertToCompatibleError(
  errorInfo: { message: string; name: string; stack?: string },
  userCodeStartLine: number
): IsolatedVMError {
  let { message, name, stack } = errorInfo

  if (stack) {
    stack = stack.replace(/<isolated-vm>:(\d+):(\d+)/g, (_, line, col) => {
      return `user-function.js:${line}:${col}`
    })
    stack = stack.replace(
      /at <isolated-vm>:(\d+):(\d+)/g,
      (_, line, col) => `at user-function.js:${line}:${col}`
    )
  }

  return { message, name, stack }
}

/**
 * Execute JavaScript code in an isolated V8 isolate
 * This provides true sandboxing that prevents prototype chain escapes
 */
export async function executeInIsolatedVM(
  req: IsolatedVMExecutionRequest
): Promise<IsolatedVMExecutionResult> {
  const { code, params, envVars, contextVariables, timeoutMs, requestId, userCodeStartLine } = req

  const stdoutChunks: string[] = []
  let isolate: ivm.Isolate | null = null

  try {
    isolate = new ivm.Isolate({ memoryLimit: 128 })
    const context = await isolate.createContext()

    const jail = context.global

    await jail.set('global', jail.derefInto())

    const logCallback = new ivm.Callback((...args: unknown[]) => {
      const message = args
        .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
        .join(' ')
      stdoutChunks.push(`${message}\n`)
    })
    await jail.set('__log', logCallback)

    const errorCallback = new ivm.Callback((...args: unknown[]) => {
      const message = args
        .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
        .join(' ')
      logger.error(`[${requestId}] Code Console Error: ${message}`)
      stdoutChunks.push(`ERROR: ${message}\n`)
    })
    await jail.set('__error', errorCallback)

    await jail.set('params', new ivm.ExternalCopy(params).copyInto())

    await jail.set('environmentVariables', new ivm.ExternalCopy(envVars).copyInto())

    for (const [key, value] of Object.entries(contextVariables)) {
      await jail.set(key, new ivm.ExternalCopy(value).copyInto())
    }

    const fetchCallback = new ivm.Reference(async (url: string, optionsJson?: string) => {
      try {
        const options = optionsJson ? JSON.parse(optionsJson) : undefined
        const result = await secureFetch(requestId, url, options)
        return JSON.stringify(result)
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown fetch error'
        return JSON.stringify({ error: errorMessage })
      }
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
        const optionsJson = options ? JSON.stringify(options) : undefined;
        const resultJson = await __fetchRef.apply(undefined, [url, optionsJson], { result: { promise: true } });
        const result = JSON.parse(resultJson);

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
          json: async () => JSON.parse(result.body),
          blob: async () => { throw new Error('blob() not supported in sandbox'); },
          arrayBuffer: async () => { throw new Error('arrayBuffer() not supported in sandbox'); },
        };
      }

      // Prevent access to dangerous globals
      const undefined_globals = [
        'Isolate', 'Context', 'Script', 'Module', 'Callback', 'Reference',
        'ExternalCopy', 'process', 'require', 'module', 'exports', '__dirname', '__filename'
      ];
      for (const name of undefined_globals) {
        try { global[name] = undefined; } catch {}
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

    let result: unknown = null
    let error: IsolatedVMError | undefined

    if (typeof resultJson === 'string') {
      try {
        const parsed = JSON.parse(resultJson)
        if (parsed.success) {
          result = parsed.result
        } else if (parsed.errorInfo) {
          error = convertToCompatibleError(parsed.errorInfo, userCodeStartLine)
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
  } catch (err: unknown) {
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
        error: convertToCompatibleError(errorInfo, userCodeStartLine),
      }
    }

    return {
      result: null,
      stdout,
      error: {
        message: String(err),
        name: 'Error',
      },
    }
  } finally {
    if (isolate) {
      isolate.dispose()
    }
  }
}
