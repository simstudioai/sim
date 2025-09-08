import { Sandbox } from '@e2b/code-interpreter'
import { createLogger } from '@/lib/logs/console/logger'
import { CodeLanguage } from './languages'

export interface E2BExecutionRequest {
  code: string
  language: CodeLanguage
  timeoutMs: number
}

export interface E2BExecutionResult {
  result: unknown
  stdout: string
  sandboxId?: string
  error?: string
}

const logger = createLogger('E2BExecution')

export async function executeInE2B(req: E2BExecutionRequest): Promise<E2BExecutionResult> {
  const { code, language, timeoutMs } = req

  logger.info(`Executing code in E2B`, {
    code,
    language,
    timeoutMs,
  })

  const apiKey = process.env.E2B_API_KEY
  if (!apiKey) {
    throw new Error('E2B_API_KEY is required when E2B is enabled')
  }

  const sandbox = await Sandbox.create({ apiKey })
  const sandboxId = sandbox.sandboxId

  const stdoutChunks = []

  try {
    const execution = await sandbox.runCode(code, {
      language: language === CodeLanguage.Python ? 'python' : 'javascript',
      timeoutMs,
    })

    // Check for execution errors
    if (execution.error) {
      const errorMessage = `${execution.error.name}: ${execution.error.value}`
      logger.error(`E2B execution error`, {
        sandboxId,
        error: execution.error,
        errorMessage,
      })

      // Include error traceback in stdout if available
      const errorOutput = execution.error.traceback || errorMessage
      return {
        result: null,
        stdout: errorOutput,
        error: errorMessage,
        sandboxId,
      }
    }

    // Get output from execution
    if (execution.text) {
      stdoutChunks.push(execution.text)
    }
    if (execution.logs?.stdout) {
      stdoutChunks.push(...execution.logs.stdout)
    }
    if (execution.logs?.stderr) {
      stdoutChunks.push(...execution.logs.stderr)
    }

    const stdout = stdoutChunks.join('\n')

    let result: unknown = null
    const prefix = '__SIM_RESULT__='
    const lines = stdout.split('\n')
    const marker = lines.find((l) => l.startsWith(prefix))
    let cleanedStdout = stdout
    if (marker) {
      const jsonPart = marker.slice(prefix.length)
      try {
        result = JSON.parse(jsonPart)
      } catch {
        result = jsonPart
      }
      cleanedStdout = lines.filter((l) => !l.startsWith(prefix)).join('\n')
    }

    return { result, stdout: cleanedStdout, sandboxId }
  } finally {
    try {
      await sandbox.kill()
    } catch {}
  }
}
