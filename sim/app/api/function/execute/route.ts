import { NextRequest, NextResponse } from 'next/server'
import { createContext, Script } from 'vm'
import { createLogger } from '@/lib/logs/console-logger'

// Explicitly export allowed methods
export const dynamic = 'force-dynamic' // Disable static optimization
export const runtime = 'nodejs' // Use Node.js runtime

const logger = createLogger('FunctionExecuteAPI')

/**
 * Resolves environment variables and tags in code
 * @param code - Code with variables
 * @param params - Parameters that may contain variable values
 * @param envVars - Environment variables from the workflow
 * @returns Resolved code
 */
function resolveCodeVariables(
  code: string,
  params: Record<string, any>,
  envVars: Record<string, string> = {}
): string {
  let resolvedCode = code

  // Resolve environment variables with {{var_name}} syntax
  const envVarMatches = resolvedCode.match(/\{\{([^}]+)\}\}/g) || []
  for (const match of envVarMatches) {
    const varName = match.slice(2, -2).trim()
    // Priority: 1. Environment variables from workflow, 2. Params, 3. process.env
    const varValue = envVars[varName] || params[varName] || process.env[varName] || ''
    resolvedCode = resolvedCode.replace(match, varValue)
  }

  // Resolve tags with <tag_name> syntax
  const tagMatches = resolvedCode.match(/<([^>]+)>/g) || []
  for (const match of tagMatches) {
    const tagName = match.slice(1, -1).trim()
    const tagValue = params[tagName] || ''
    resolvedCode = resolvedCode.replace(match, tagValue)
  }

  return resolvedCode
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const startTime = Date.now()
  let stdout = ''

  try {
    const body = await req.json()

    const { code, params = {}, timeout = 3000, envVars = {} } = body

    logger.debug(`[${requestId}] Executing function with params`, {
      hasParams: Object.keys(params).length > 0,
      timeout,
      hasEnvVars: Object.keys(envVars).length > 0,
    })

    // Resolve variables in the code with workflow environment variables
    const resolvedCode = resolveCodeVariables(code, params, envVars)

    // Create a secure context with console logging
    const context = createContext({
      params,
      environmentVariables: envVars, // Make environment variables available in the context
      console: {
        log: (...args: any[]) => {
          const logMessage =
            args
              .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
              .join(' ')
          stdout += logMessage
        },
        error: (...args: any[]) => {
          const errorMessage =
            args
              .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
              .join(' ')
          logger.error(`[${requestId}] Code Console Error:`, errorMessage)
          stdout += 'ERROR: ' + errorMessage
        },
      },
    })

    const script = new Script(`
      (async () => {
        try {
          ${resolvedCode}
        } catch (error) {
          console.error(error);
          throw error;
        }
      })()
    `)

    const result = await script.runInContext(context, {
      timeout,
      displayErrors: true,
    })

    const executionTime = Date.now() - startTime
    logger.info(`[${requestId}] Function executed successfully`, {
      executionTime,
    })

    const response = {
      success: true,
      output: {
        result,
        stdout,
        executionTime,
      },
    }

    return NextResponse.json(response)
  } catch (error: any) {
    const executionTime = Date.now() - startTime
    logger.error(`[${requestId}] Function execution failed`, {
      error: error.message || 'Unknown error',
      executionTime,
    })

    const errorResponse = {
      success: false,
      error: error.message || 'Code execution failed',
      output: {
        result: null,
        stdout,
        executionTime,
      },
    }

    return NextResponse.json(errorResponse, { status: 500 })
  }
}
