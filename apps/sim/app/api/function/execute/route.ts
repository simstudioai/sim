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
  envVars: Record<string, string> = {},
  blockData: Record<string, any> = {},
  blockNameMapping: Record<string, string> = {}
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

  // Resolve tags with <tag_name> syntax (including nested paths like <block.response.data>)
  const tagMatches = resolvedCode.match(/<([a-zA-Z_][a-zA-Z0-9_.]*[a-zA-Z0-9_])>/g) || []

  for (const match of tagMatches) {
    const tagName = match.slice(1, -1).trim()

    // Handle nested paths like "getrecord.response.data" or "function1.response.result"
    // First try params, then blockData directly, then try with block name mapping
    let tagValue = getNestedValue(params, tagName) || getNestedValue(blockData, tagName) || ''

    // If not found and the path starts with a block name, try mapping the block name to ID
    if (!tagValue && tagName.includes('.')) {
      const pathParts = tagName.split('.')
      const normalizedBlockName = pathParts[0] // This should already be normalized like "function1"

      // Find the block ID by looking for a block name that normalizes to this value
      let blockId = null
      let matchedBlockName = null

      for (const [blockName, id] of Object.entries(blockNameMapping)) {
        // Apply the same normalization logic as the UI: remove spaces and lowercase
        const normalizedName = blockName.replace(/\s+/g, '').toLowerCase()
        if (normalizedName === normalizedBlockName) {
          blockId = id
          matchedBlockName = blockName
          break
        }
      }

      if (blockId) {
        const remainingPath = pathParts.slice(1).join('.')
        const fullPath = `${blockId}.${remainingPath}`
        tagValue = getNestedValue(blockData, fullPath) || ''
      }
    }

    // If the value is a stringified JSON, parse it back to object
    if (
      typeof tagValue === 'string' &&
      tagValue.length > 100 &&
      (tagValue.startsWith('{') || tagValue.startsWith('['))
    ) {
      try {
        tagValue = JSON.parse(tagValue)
      } catch (e) {
        // Keep as string if parsing fails
      }
    }

    // Instead of injecting large JSON directly, create a variable reference
    const safeVarName = `__tag_${tagName.replace(/[^a-zA-Z0-9_]/g, '_')}`
    contextVariables[safeVarName] = tagValue

    // Replace the template with a variable reference
    resolvedCode = resolvedCode.replace(new RegExp(escapeRegExp(match), 'g'), safeVarName)
  }

  return { resolvedCode, contextVariables }
}

/**
 * Get nested value from object using dot notation path
 */
function getNestedValue(obj: any, path: string): any {
  if (!obj || !path) return undefined

  return path.split('.').reduce((current, key) => {
    return current && typeof current === 'object' ? current[key] : undefined
  }, obj)
}

/**
 * Escape special regex characters in a string
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Creates a detailed error message for JavaScript syntax errors
 */
function createDetailedSyntaxError(error: any, code: string, resolvedCode: string): string {
  let errorMessage = 'JavaScript Syntax Error: '

  // Extract line and column information if available
  let lineNumber: number | undefined
  let columnNumber: number | undefined

  if (error.stack) {
    // Try to extract line/column from stack trace
    const lineMatch = error.stack.match(/:(\d+):(\d+)/) || error.stack.match(/line (\d+)/)
    if (lineMatch) {
      lineNumber = Number.parseInt(lineMatch[1])
      columnNumber = lineMatch[2] ? Number.parseInt(lineMatch[2]) : undefined
    }
  }

  // Parse the error message to provide more context
  const originalError = error.message || error.toString()

  if (originalError.includes('Unexpected token')) {
    const tokenMatch = originalError.match(/Unexpected token ['"']?([^'"'\s]+)['"']?/)
    if (tokenMatch) {
      errorMessage += `Unexpected token "${tokenMatch[1]}"`
    } else {
      errorMessage += originalError
    }
  } else if (originalError.includes('Unexpected end of input')) {
    errorMessage +=
      'Unexpected end of input - you may be missing a closing brace "}", bracket "]", or parenthesis ")"'
  } else if (originalError.includes('Missing') || originalError.includes('Expected')) {
    errorMessage += originalError
  } else {
    errorMessage += originalError
  }

  // Add line information if available
  if (lineNumber) {
    errorMessage += ` at line ${lineNumber}`
    if (columnNumber) {
      errorMessage += `, column ${columnNumber}`
    }
  }

  // Show the problematic code section
  const codeLines = resolvedCode.split('\n')
  if (lineNumber && lineNumber <= codeLines.length) {
    errorMessage += '\n\nProblematic code:'

    // Show a few lines around the error for context
    const startLine = Math.max(0, lineNumber - 3)
    const endLine = Math.min(codeLines.length, lineNumber + 2)

    for (let i = startLine; i < endLine; i++) {
      const isErrorLine = i + 1 === lineNumber
      const lineNum = (i + 1).toString().padStart(3, ' ')
      const prefix = isErrorLine ? '>>>' : '   '
      errorMessage += `\n${prefix} ${lineNum} | ${codeLines[i]}`

      // Add pointer to the column if available
      if (isErrorLine && columnNumber) {
        const pointer = `${' '.repeat(prefix.length + lineNum.length + 3 + columnNumber - 1)}^`
        errorMessage += `\n${pointer}`
      }
    }
  } else {
    // If we can't pinpoint the line, show the first few lines of code for context
    errorMessage += '\n\nYour code:'
    const previewLines = code.split('\n').slice(0, 5)
    previewLines.forEach((line, index) => {
      errorMessage += `\n    ${(index + 1).toString().padStart(2, ' ')} | ${line}`
    })
    if (code.split('\n').length > 5) {
      errorMessage += '\n    ... (more lines)'
    }
  }

  return errorMessage
}

/**
 * Creates a detailed error message for runtime errors
 */
function createDetailedRuntimeError(error: any, stdout: string): string {
  let errorMessage = 'JavaScript Runtime Error: '

  if (error.name && error.name !== 'Error') {
    errorMessage += `${error.name}: `
  }

  errorMessage += error.message || error.toString()

  // Add stack trace information if available
  if (error.stack) {
    const stackLines = error.stack.split('\n').slice(1, 4) // Take first few stack frames
    if (stackLines.length > 0) {
      errorMessage += '\n\nStack trace:'
      stackLines.forEach((line: string) => {
        if (line.trim()) {
          errorMessage += `\n    ${line.trim()}`
        }
      })
    }
  }

  // Include console output if there was any
  if (stdout?.trim()) {
    errorMessage += '\n\nConsole output:'
    errorMessage += `\n${stdout}`
  }

  return errorMessage
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
      blockData = {},
      blockNameMapping = {},
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
    logger.info(`[${requestId}] Original code:`, code.substring(0, 200))
    logger.info(`[${requestId}] Execution params keys:`, Object.keys(executionParams))

    const { resolvedCode, contextVariables } = resolveCodeVariables(
      code,
      executionParams,
      envVars,
      blockData,
      blockNameMapping
    )

    logger.info(`[${requestId}] Resolved code:`, resolvedCode.substring(0, 200))
    logger.info(`[${requestId}] Context variables keys:`, Object.keys(contextVariables))

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

    const codeToExecute = `
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
    `

    let result: any
    try {
      // Try to create and execute the script
      const script = new Script(codeToExecute)
      result = await script.runInContext(context, {
        timeout,
        displayErrors: true,
      })
    } catch (scriptError: any) {
      // Check if this is a syntax error (compilation error) vs runtime error
      const isSyntaxError =
        scriptError.name === 'SyntaxError' ||
        scriptError.message?.includes('Unexpected token') ||
        scriptError.message?.includes('Unexpected end of input') ||
        scriptError.message?.includes('Missing') ||
        scriptError.constructor?.name === 'SyntaxError'

      if (isSyntaxError) {
        // Handle syntax errors with detailed context
        const detailedError = createDetailedSyntaxError(scriptError, code, codeToExecute)
        logger.error(`[${requestId}] JavaScript syntax error`, {
          originalError: scriptError.message,
          detailedError,
          code: code.substring(0, 500) + (code.length > 500 ? '...' : ''),
        })
        throw new Error(detailedError)
      }
      // Handle runtime errors
      const detailedError = createDetailedRuntimeError(scriptError, stdout)
      logger.error(`[${requestId}] JavaScript runtime error`, {
        originalError: scriptError.message,
        detailedError,
        stdout,
      })
      throw new Error(detailedError)
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
