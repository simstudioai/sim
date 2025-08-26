import { createContext, Script } from 'vm'
import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const logger = createLogger('FunctionExecuteAPI')

/**
 * Enhanced error information interface
 */
interface EnhancedError {
  message: string
  line?: number
  column?: number
  stack?: string
  name: string
  originalError: any
  lineContent?: string
}

/**
 * Extract enhanced error information from VM execution errors
 */
function extractEnhancedError(
  error: any,
  userCodeStartLine: number,
  userCode?: string
): EnhancedError {
  const enhanced: EnhancedError = {
    message: error.message || 'Unknown error',
    name: error.name || 'Error',
    originalError: error,
  }

  if (error.stack) {
    enhanced.stack = error.stack

    // Parse stack trace to extract line and column information
    // Handle both compilation errors and runtime errors
    const stackLines: string[] = error.stack.split('\n')

    for (const line of stackLines) {
      // Pattern 1: Compilation errors - "user-function.js:6"
      let match = line.match(/user-function\.js:(\d+)(?::(\d+))?/)

      // Pattern 2: Runtime errors - "at user-function.js:5:12"
      if (!match) {
        match = line.match(/at\s+user-function\.js:(\d+):(\d+)/)
      }

      // Pattern 3: Generic patterns for any line containing our filename
      if (!match) {
        match = line.match(/user-function\.js:(\d+)(?::(\d+))?/)
      }

      if (match) {
        const stackLine = Number.parseInt(match[1], 10)
        const stackColumn = match[2] ? Number.parseInt(match[2], 10) : undefined

        // Adjust line number to account for wrapper code
        // The user code starts at a specific line in our wrapper
        const adjustedLine = stackLine - userCodeStartLine + 1

        // Check if this is a syntax error in wrapper code caused by incomplete user code
        const isWrapperSyntaxError =
          stackLine > userCodeStartLine &&
          error.name === 'SyntaxError' &&
          (error.message.includes('Unexpected token') ||
            error.message.includes('Unexpected end of input'))

        if (isWrapperSyntaxError && userCode) {
          // Map wrapper syntax errors to the last line of user code
          const codeLines = userCode.split('\n')
          const lastUserLine = codeLines.length
          enhanced.line = lastUserLine
          enhanced.column = codeLines[lastUserLine - 1]?.length || 0
          enhanced.lineContent = codeLines[lastUserLine - 1]?.trim()
          break
        }

        if (adjustedLine > 0) {
          enhanced.line = adjustedLine
          enhanced.column = stackColumn

          // Extract the actual line content from user code
          if (userCode) {
            const codeLines = userCode.split('\n')
            if (adjustedLine <= codeLines.length) {
              enhanced.lineContent = codeLines[adjustedLine - 1]?.trim()
            }
          }
          break
        }

        if (stackLine <= userCodeStartLine) {
          // Error is in wrapper code itself
          enhanced.line = stackLine
          enhanced.column = stackColumn
          break
        }
      }
    }

    // Clean up stack trace to show user-relevant information
    const cleanedStackLines: string[] = stackLines
      .filter(
        (line: string) =>
          line.includes('user-function.js') ||
          (!line.includes('vm.js') && !line.includes('internal/'))
      )
      .map((line: string) => line.replace(/\s+at\s+/, '    at '))

    if (cleanedStackLines.length > 0) {
      enhanced.stack = cleanedStackLines.join('\n')
    }
  }

  // Keep original message without adding error type prefix
  // The error type will be added later in createUserFriendlyErrorMessage

  return enhanced
}

/**
 * Create a detailed error message for users
 */
function createUserFriendlyErrorMessage(
  enhanced: EnhancedError,
  requestId: string,
  userCode?: string
): string {
  let errorMessage = enhanced.message

  // Add line and column information if available
  if (enhanced.line !== undefined) {
    let lineInfo = `Line ${enhanced.line}${enhanced.column !== undefined ? `:${enhanced.column}` : ''}`

    // Add the actual line content if available
    if (enhanced.lineContent) {
      lineInfo += `: \`${enhanced.lineContent}\``
    }

    errorMessage = `${lineInfo} - ${errorMessage}`
  } else {
    // If no line number, try to extract it from stack trace for display
    if (enhanced.stack) {
      const stackMatch = enhanced.stack.match(/user-function\.js:(\d+)(?::(\d+))?/)
      if (stackMatch) {
        const line = Number.parseInt(stackMatch[1], 10)
        const column = stackMatch[2] ? Number.parseInt(stackMatch[2], 10) : undefined
        let lineInfo = `Line ${line}${column ? `:${column}` : ''}`

        // Try to get line content if we have userCode
        if (userCode) {
          const codeLines = userCode.split('\n')
          // Note: stackMatch gives us VM line number, need to adjust
          // This is a fallback case, so we might not have perfect line mapping
          if (line <= codeLines.length) {
            const lineContent = codeLines[line - 1]?.trim()
            if (lineContent) {
              lineInfo += `: \`${lineContent}\``
            }
          }
        }

        errorMessage = `${lineInfo} - ${errorMessage}`
      }
    }
  }

  // Add error type prefix with consistent naming
  if (enhanced.name !== 'Error') {
    const errorTypePrefix =
      enhanced.name === 'SyntaxError'
        ? 'Syntax Error'
        : enhanced.name === 'TypeError'
          ? 'Type Error'
          : enhanced.name === 'ReferenceError'
            ? 'Reference Error'
            : enhanced.name

    // Only add prefix if not already present
    if (!errorMessage.toLowerCase().includes(errorTypePrefix.toLowerCase())) {
      errorMessage = `${errorTypePrefix}: ${errorMessage}`
    }
  }

  // For syntax errors, provide additional context
  if (enhanced.name === 'SyntaxError') {
    if (errorMessage.includes('Invalid or unexpected token')) {
      errorMessage += ' (Check for missing quotes, brackets, or semicolons)'
    } else if (errorMessage.includes('Unexpected end of input')) {
      errorMessage += ' (Check for missing closing brackets or braces)'
    } else if (errorMessage.includes('Unexpected token')) {
      // Check if this might be due to incomplete code
      if (
        enhanced.lineContent &&
        ((enhanced.lineContent.includes('(') && !enhanced.lineContent.includes(')')) ||
          (enhanced.lineContent.includes('[') && !enhanced.lineContent.includes(']')) ||
          (enhanced.lineContent.includes('{') && !enhanced.lineContent.includes('}')))
      ) {
        errorMessage += ' (Check for missing closing parentheses, brackets, or braces)'
      } else {
        errorMessage += ' (Check your syntax)'
      }
    }
  }

  return errorMessage
}

/**
 * Resolves workflow variables with <variable.name> syntax
 */
function resolveWorkflowVariables(
  code: string,
  workflowVariables: Record<string, any>,
  contextVariables: Record<string, any>
): string {
  let resolvedCode = code

  const variableMatches = resolvedCode.match(/<variable\.([^>]+)>/g) || []
  for (const match of variableMatches) {
    const variableName = match.slice('<variable.'.length, -1).trim()

    // Find the variable by name (workflowVariables is indexed by ID, values are variable objects)
    const foundVariable = Object.entries(workflowVariables).find(
      ([_, variable]) => (variable.name || '').replace(/\s+/g, '') === variableName
    )

    if (foundVariable) {
      const variable = foundVariable[1]
      // Get the typed value - handle different variable types
      let variableValue = variable.value

      if (variable.value !== undefined && variable.value !== null) {
        try {
          // Handle 'string' type the same as 'plain' for backward compatibility
          const type = variable.type === 'string' ? 'plain' : variable.type

          // For plain text, use exactly what's entered without modifications
          if (type === 'plain' && typeof variableValue === 'string') {
            // Use as-is for plain text
          } else if (type === 'number') {
            variableValue = Number(variableValue)
          } else if (type === 'boolean') {
            variableValue = variableValue === 'true' || variableValue === true
          } else if (type === 'json') {
            try {
              variableValue =
                typeof variableValue === 'string' ? JSON.parse(variableValue) : variableValue
            } catch {
              // Keep original value if JSON parsing fails
            }
          }
        } catch (error) {
          // Fallback to original value on error
          variableValue = variable.value
        }
      }

      // Create a safe variable reference
      const safeVarName = `__variable_${variableName.replace(/[^a-zA-Z0-9_]/g, '_')}`
      contextVariables[safeVarName] = variableValue

      // Replace the variable reference with the safe variable name
      resolvedCode = resolvedCode.replace(new RegExp(escapeRegExp(match), 'g'), safeVarName)
    } else {
      // Variable not found - replace with empty string to avoid syntax errors
      resolvedCode = resolvedCode.replace(new RegExp(escapeRegExp(match), 'g'), '')
    }
  }

  return resolvedCode
}

/**
 * Resolves environment variables with {{var_name}} syntax
 */
function resolveEnvironmentVariables(
  code: string,
  params: Record<string, any>,
  envVars: Record<string, string>,
  contextVariables: Record<string, any>
): string {
  let resolvedCode = code

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

  return resolvedCode
}

/**
 * Resolves tags with <tag_name> syntax (including nested paths like <block.response.data>)
 */
function resolveTagVariables(
  code: string,
  params: Record<string, any>,
  blockData: Record<string, any>,
  blockNameMapping: Record<string, string>,
  contextVariables: Record<string, any>
): string {
  let resolvedCode = code

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

      for (const [blockName, id] of Object.entries(blockNameMapping)) {
        // Apply the same normalization logic as the UI: remove spaces and lowercase
        const normalizedName = blockName.replace(/\s+/g, '').toLowerCase()
        if (normalizedName === normalizedBlockName) {
          blockId = id
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

  return resolvedCode
}

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
  blockNameMapping: Record<string, string> = {},
  workflowVariables: Record<string, any> = {}
): { resolvedCode: string; contextVariables: Record<string, any> } {
  let resolvedCode = code
  const contextVariables: Record<string, any> = {}

  // Resolve workflow variables with <variable.name> syntax first
  resolvedCode = resolveWorkflowVariables(resolvedCode, workflowVariables, contextVariables)

  // Resolve environment variables with {{var_name}} syntax
  resolvedCode = resolveEnvironmentVariables(resolvedCode, params, envVars, contextVariables)

  // Resolve tags with <tag_name> syntax (including nested paths like <block.response.data>)
  resolvedCode = resolveTagVariables(
    resolvedCode,
    params,
    blockData,
    blockNameMapping,
    contextVariables
  )

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

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const startTime = Date.now()
  let stdout = ''
  let userCodeStartLine = 3 // Default value for error reporting
  let resolvedCode = '' // Store resolved code for error reporting

  try {
    const body = await req.json()

    const {
      code,
      params = {},
      timeout = 5000,
      envVars = {},
      blockData = {},
      blockNameMapping = {},
      workflowVariables = {},
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
    const codeResolution = resolveCodeVariables(
      code,
      executionParams,
      envVars,
      blockData,
      blockNameMapping,
      workflowVariables
    )
    resolvedCode = codeResolution.resolvedCode
    const contextVariables = codeResolution.contextVariables

    const executionMethod = 'vm' // Default execution method

    logger.info(`[${requestId}] Using VM for code execution`, {
      hasEnvVars: Object.keys(envVars).length > 0,
      hasWorkflowVariables: Object.keys(workflowVariables).length > 0,
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

    // Calculate line offset for user code to provide accurate error reporting
    const wrapperLines = ['(async () => {', '  try {']

    // Add custom tool parameter declarations if needed
    if (isCustomTool) {
      wrapperLines.push('    // For custom tools, make parameters directly accessible')
      Object.keys(executionParams).forEach((key) => {
        wrapperLines.push(`    const ${key} = params.${key};`)
      })
    }

    userCodeStartLine = wrapperLines.length + 1 // +1 because user code starts on next line

    // Build the complete script with proper formatting for line numbers
    const fullScript = [
      ...wrapperLines,
      `    ${resolvedCode.split('\n').join('\n    ')}`, // Indent user code
      '  } catch (error) {',
      '    console.error(error);',
      '    throw error;',
      '  }',
      '})()',
    ].join('\n')

    const script = new Script(fullScript, {
      filename: 'user-function.js', // This filename will appear in stack traces
      lineOffset: 0, // Start line numbering from 0
      columnOffset: 0, // Start column numbering from 0
    })

    const result = await script.runInContext(context, {
      timeout,
      displayErrors: true,
      breakOnSigint: true, // Allow breaking on SIGINT for better debugging
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

    const enhancedError = extractEnhancedError(error, userCodeStartLine, resolvedCode)
    const userFriendlyErrorMessage = createUserFriendlyErrorMessage(
      enhancedError,
      requestId,
      resolvedCode
    )

    // Log enhanced error details for debugging
    logger.error(`[${requestId}] Enhanced error details`, {
      originalMessage: error.message,
      enhancedMessage: userFriendlyErrorMessage,
      line: enhancedError.line,
      column: enhancedError.column,
      lineContent: enhancedError.lineContent,
      errorType: enhancedError.name,
      userCodeStartLine,
    })

    const errorResponse = {
      success: false,
      error: userFriendlyErrorMessage,
      output: {
        result: null,
        stdout,
        executionTime,
      },
      // Include debug information in development or for debugging
      debug: {
        line: enhancedError.line,
        column: enhancedError.column,
        errorType: enhancedError.name,
        lineContent: enhancedError.lineContent,
        stack: enhancedError.stack,
      },
    }

    return NextResponse.json(errorResponse, { status: 500 })
  }
}
