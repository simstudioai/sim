import { createContext, Script } from 'vm'
import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

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
): { resolvedCode: string; contextVariables: Record<string, any> } {
  let resolvedCode = code
  const contextVariables: Record<string, any> = {}

  // Resolve environment variables with {{var_name}} syntax
  const envVarMatches = resolvedCode.match(/\{\{([^}]+)\}\}/g) || []
  for (const match of envVarMatches) {
    const varName = match.slice(2, -2).trim()
    // Priority: 1. Environment variables from workflow, 2. Params
    const varValue = envVars[varName] || params[varName] || ''

    // Instead of injecting large JSON directly, create a variable reference
    const safeVarName = `__var_${varName.replace(/[^a-zA-Z0-9_]/g, '_')}`
    contextVariables[safeVarName] = varValue

    // Replace the template with a variable reference
    resolvedCode = resolvedCode.replace(new RegExp(escapeRegExp(match), 'g'), safeVarName)
  }

  // Resolve tags with <tag_name> syntax
  const tagMatches = resolvedCode.match(/<([a-zA-Z_][a-zA-Z0-9_]*)>/g) || []
  for (const match of tagMatches) {
    const tagName = match.slice(1, -1).trim()
    const tagValue = params[tagName] || ''

    // Instead of injecting large JSON directly, create a variable reference
    const safeVarName = `__tag_${tagName.replace(/[^a-zA-Z0-9_]/g, '_')}`
    contextVariables[safeVarName] = tagValue

    // Replace the template with a variable reference
    resolvedCode = resolvedCode.replace(new RegExp(escapeRegExp(match), 'g'), safeVarName)
  }

  return { resolvedCode, contextVariables }
}

/**
 * Escape special regex characters in a string
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
    executionParams._context = undefined

    logger.info(`[${requestId}] Function execution request`, {
      hasCode: !!code,
      paramsCount: Object.keys(executionParams).length,
      timeout,
      workflowId,
      isCustomTool,
    })

    // Resolve variables in the code with workflow environment variables
    const { resolvedCode, contextVariables } = resolveCodeVariables(code, executionParams, envVars)

    const executionMethod = 'vm' // Default execution method

    // // Try to use Freestyle if the API key is available
    // if (env.FREESTYLE_API_KEY) {
    //   try {
    //     logger.info(`[${requestId}] Using Freestyle for code execution`)
    //     executionMethod = 'freestyle'

    //     // Extract npm packages from code if needed
    //     const importRegex =
    //       /import\s+?(?:(?:(?:[\w*\s{},]*)\s+from\s+?)|)(?:(?:"([^"]*)")|(?:'([^']*)'))[^;]*/g
    //     const requireRegex = /const\s+[\w\s{}]*\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g

    //     const packages: Record<string, string> = {}
    //     const matches = [
    //       ...resolvedCode.matchAll(importRegex),
    //       ...resolvedCode.matchAll(requireRegex),
    //     ]

    //     // Extract package names from import statements
    //     for (const match of matches) {
    //       const packageName = match[1] || match[2]
    //       if (packageName && !packageName.startsWith('.') && !packageName.startsWith('/')) {
    //         // Extract just the package name without version or subpath
    //         const basePackageName = packageName.split('/')[0]
    //         packages[basePackageName] = 'latest' // Use latest version
    //       }
    //     }

    //     const freestyle = new FreestyleSandboxes({
    //       apiKey: env.FREESTYLE_API_KEY,
    //     })

    //     // Wrap code in export default to match Freestyle's expectations
    //     const wrappedCode = isCustomTool
    //       ? `export default async () => {
    //           // For custom tools, directly declare parameters as variables
    //           ${Object.entries(executionParams)
    //             .map(([key, value]) => `const ${key} = ${safeJSONStringify(value)};`)
    //             .join('\n              ')}
    //           ${resolvedCode}
    //         }`
    //       : `export default async () => { ${resolvedCode} }`

    //     // Execute the code with Freestyle
    //     const res = await freestyle.executeScript(wrappedCode, {
    //       nodeModules: packages,
    //       timeout: null,
    //       envVars: envVars,
    //     })

    //     // Check for direct API error response
    //     // Type assertion since the library types don't include error response
    //     const response = res as { _type?: string; error?: string }
    //     if (response._type === 'error' && response.error) {
    //       logger.error(`[${requestId}] Freestyle returned error response`, {
    //         error: response.error,
    //       })
    //       throw response.error
    //     }

    //     // Capture stdout/stderr from Freestyle logs
    //     stdout =
    //       res.logs
    //         ?.map((log) => (log.type === 'error' ? 'ERROR: ' : '') + log.message)
    //         .join('\n') || ''

    //     // Check for errors reported within Freestyle logs
    //     const freestyleErrors = res.logs?.filter((log) => log.type === 'error') || []
    //     if (freestyleErrors.length > 0) {
    //       const errorMessage = freestyleErrors.map((log) => log.message).join('\n')
    //       logger.error(`[${requestId}] Freestyle execution completed with script errors`, {
    //         errorMessage,
    //         stdout,
    //       })
    //       // Create a proper Error object to be caught by the outer handler
    //       const scriptError = new Error(errorMessage)
    //       scriptError.name = 'FreestyleScriptError'
    //       throw scriptError
    //     }

    //     // If no errors, execution was successful
    //     result = res.result
    //     logger.info(`[${requestId}] Freestyle execution successful`, {
    //       result,
    //       stdout,
    //     })
    //   } catch (error: any) {
    //     // Check if the error came from our explicit throw above due to script errors
    //     if (error.name === 'FreestyleScriptError') {
    //       throw error // Re-throw to be caught by the outer handler
    //     }

    //     // Otherwise, it's likely a Freestyle API call error (network, auth, config, etc.) -> Fallback to VM
    //     logger.error(`[${requestId}] Freestyle API call failed, falling back to VM:`, {
    //       error: error.message,
    //       stack: error.stack,
    //     })
    //     executionMethod = 'vm_fallback'

    //     // Continue to VM execution
    //     const context = createContext({
    //       params: executionParams,
    //       environmentVariables: envVars,
    //       console: {
    //         log: (...args: any[]) => {
    //           const logMessage = `${args
    //             .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
    //             .join(' ')}\n`
    //           stdout += logMessage
    //         },
    //         error: (...args: any[]) => {
    //           const errorMessage = `${args
    //             .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
    //             .join(' ')}\n`
    //           logger.error(`[${requestId}] Code Console Error: ${errorMessage}`)
    //           stdout += `ERROR: ${errorMessage}`
    //         },
    //       },
    //     })

    //     const script = new Script(`
    //       (async () => {
    //         try {
    //           ${
    //             isCustomTool
    //               ? `// For custom tools, make parameters directly accessible
    //               ${Object.keys(executionParams)
    //                 .map((key) => `const ${key} = params.${key};`)
    //                 .join('\n                  ')}`
    //               : ''
    //           }
    //           ${resolvedCode}
    //         } catch (error) {
    //           console.error(error);
    //           throw error;
    //         }
    //       })()
    //     `)

    //     result = await script.runInContext(context, {
    //       timeout,
    //       displayErrors: true,
    //     })
    //     logger.info(`[${requestId}] VM execution result`, {
    //       result,
    //       stdout,
    //     })
    //   }
    // } else {
    logger.info(`[${requestId}] Using VM for code execution`, {
      resolvedCode,
      executionParams,
      envVars,
    })

    // Create a secure context with console logging
    const context = createContext({
      params: executionParams,
      environmentVariables: envVars,
      ...contextVariables, // Add resolved variables directly to context
      fetch: globalThis.fetch || require('node-fetch').default,
      console: {
        log: (...args: any[]) => {
          const logMessage = `${args
            .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
            .join(' ')}\n`
          stdout += logMessage
        },
        error: (...args: any[]) => {
          const errorMessage = `${args
            .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
            .join(' ')}\n`
          logger.error(`[${requestId}] Code Console Error: ${errorMessage}`)
          stdout += `ERROR: ${errorMessage}`
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

    const result = await script.runInContext(context, {
      timeout,
      displayErrors: true,
    })
    // }

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
