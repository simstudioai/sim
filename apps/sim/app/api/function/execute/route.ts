import { NextRequest, NextResponse } from 'next/server'
import { FreestyleSandboxes } from 'freestyle-sandboxes'
import { createContext, Script } from 'vm'
import { env } from '@/lib/env'
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
    // Priority: 1. Environment variables from workflow, 2. Params
    const varValue = envVars[varName] || params[varName] || ''
    // Wrap the value in quotes to ensure it's treated as a string literal
    resolvedCode = resolvedCode.replace(match, JSON.stringify(varValue))
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

    const {
      code,
      params = {},
      timeout = 5000,
      envVars = {},
      workflowId,
      isCustomTool = false,
    } = body

    // Extract internal parameters that shouldn't be passed to the execution context
    const executionParams = { ...params }
    delete executionParams._context

    // Resolve variables in the code with workflow environment variables
    const resolvedCode = resolveCodeVariables(code, executionParams, envVars)

    let result: any
    let executionMethod = 'vm' // Default execution method

    // Try to use Freestyle if the API key is available
    if (env.FREESTYLE_API_KEY) {
      try {
        logger.info(`[${requestId}] Using Freestyle for code execution`)
        executionMethod = 'freestyle'

        // Extract npm packages from code if needed
        const importRegex =
          /import\s+?(?:(?:(?:[\w*\s{},]*)\s+from\s+?)|)(?:(?:"([^"]*)")|(?:'([^']*)'))[^;]*/g
        const requireRegex = /const\s+[\w\s{}]*\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g

        const packages: Record<string, string> = {}
        const matches = [
          ...resolvedCode.matchAll(importRegex),
          ...resolvedCode.matchAll(requireRegex),
        ]

        // Extract package names from import statements
        for (const match of matches) {
          const packageName = match[1] || match[2]
          if (packageName && !packageName.startsWith('.') && !packageName.startsWith('/')) {
            // Extract just the package name without version or subpath
            const basePackageName = packageName.split('/')[0]
            packages[basePackageName] = 'latest' // Use latest version
          }
        }

        const freestyle = new FreestyleSandboxes({
          apiKey: env.FREESTYLE_API_KEY,
        })

        // Wrap code in export default to match Freestyle's expectations
        const wrappedCode = isCustomTool
          ? `export default async () => { 
              // For custom tools, directly declare parameters as variables
              ${Object.entries(executionParams)
                .map(([key, value]) => `const ${key} = ${JSON.stringify(value)};`)
                .join('\n              ')}
              ${resolvedCode} 
            }`
          : `export default async () => { ${resolvedCode} }`

        // Execute the code with Freestyle
        const res = await freestyle.executeScript(wrappedCode, {
          nodeModules: packages,
          timeout: null,
          envVars: envVars,
        })

        // Check for direct API error response
        // Type assertion since the library types don't include error response
        const response = res as { _type?: string; error?: string }
        if (response._type === 'error' && response.error) {
          logger.error(`[${requestId}] Freestyle returned error response`, {
            error: response.error,
          })
          throw response.error
        }

        // Capture stdout/stderr from Freestyle logs
        stdout =
          res.logs
            ?.map((log) => (log.type === 'error' ? 'ERROR: ' : '') + log.message)
            .join('\n') || ''

        // Check for errors reported within Freestyle logs
        const freestyleErrors = res.logs?.filter((log) => log.type === 'error') || []
        if (freestyleErrors.length > 0) {
          const errorMessage = freestyleErrors.map((log) => log.message).join('\n')
          logger.error(`[${requestId}] Freestyle execution completed with script errors`, {
            errorMessage,
            stdout,
          })
          throw errorMessage
        }

        // If no errors, execution was successful
        result = res.result
        logger.info(`[${requestId}] Freestyle execution successful`, {
          result,
          stdout,
        })
      } catch (error: any) {
        // Check if the error came from our explicit throw above due to script errors
        if (error instanceof Error) {
          throw error // Re-throw to be caught by the outer handler
        }

        // Otherwise, it's likely a Freestyle API call error (network, auth, config, etc.) -> Fallback to VM
        logger.error(`[${requestId}] Freestyle API call failed, falling back to VM:`, {
          error: error.message,
          stack: error.stack,
        })
        executionMethod = 'vm_fallback'

        // Continue to VM execution
        const context = createContext({
          params: executionParams,
          environmentVariables: envVars,
          console: {
            log: (...args: any[]) => {
              const logMessage =
                args
                  .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
                  .join(' ') + '\n'
              stdout += logMessage
            },
            error: (...args: any[]) => {
              const errorMessage =
                args
                  .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
                  .join(' ') + '\n'
              logger.error(`[${requestId}] Code Console Error:`, errorMessage)
              stdout += 'ERROR: ' + errorMessage
            },
          },
        })

        const script = new Script(`
          (async () => {
            try {
              ${
                isCustomTool
                  ? `// For custom tools, make parameters directly accessible
                  ${Object.keys(executionParams)
                    .map((key) => `const ${key} = params.${key};`)
                    .join('\n                  ')}`
                  : ''
              }
              ${resolvedCode}
            } catch (error) {
              console.error(error);
              throw error;
            }
          })()
        `)

        result = await script.runInContext(context, {
          timeout,
          displayErrors: true,
        })
        logger.info(`[${requestId}] VM execution result`, {
          result,
          stdout,
        })
      }
    } else {
      // No Freestyle API key, use VM execution
      logger.info(`[${requestId}] Using VM for code execution (no Freestyle API key available)`)

      // Create a secure context with console logging
      const context = createContext({
        params: executionParams,
        environmentVariables: envVars,
        console: {
          log: (...args: any[]) => {
            const logMessage =
              args
                .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
                .join(' ') + '\n'
            stdout += logMessage
          },
          error: (...args: any[]) => {
            const errorMessage =
              args
                .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
                .join(' ') + '\n'
            logger.error(`[${requestId}] Code Console Error:`, errorMessage)
            stdout += 'ERROR: ' + errorMessage
          },
        },
      })

      const script = new Script(`
        (async () => {
          try {
            ${
              isCustomTool
                ? `// For custom tools, make parameters directly accessible
                ${Object.keys(executionParams)
                  .map((key) => `const ${key} = params.${key};`)
                  .join('\n                ')}`
                : ''
            }
            ${resolvedCode}
          } catch (error) {
            console.error(error);
            throw error;
          }
        })()
      `)

      result = await script.runInContext(context, {
        timeout,
        displayErrors: true,
      })
    }

    const executionTime = Date.now() - startTime
    logger.info(`[${requestId}] Function executed successfully using ${executionMethod}`, {
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
      stack: error.stack,
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
