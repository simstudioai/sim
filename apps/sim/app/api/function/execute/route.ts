import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { isE2bEnabled } from '@/lib/core/config/feature-flags'
import { generateRequestId } from '@/lib/core/utils/request'
import { executeInE2B } from '@/lib/execution/e2b'
import { executeInIsolatedVM } from '@/lib/execution/isolated-vm'
import { CodeLanguage, DEFAULT_CODE_LANGUAGE, isValidCodeLanguage } from '@/lib/execution/languages'
import { escapeRegExp, normalizeName, REFERENCE } from '@/executor/constants'
import {
  createEnvVarPattern,
  createWorkflowVariablePattern,
} from '@/executor/utils/reference-validation'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const MAX_DURATION = 210

const logger = createLogger('FunctionExecuteAPI')

const E2B_JS_WRAPPER_LINES = 3 // Lines before user code: ';(async () => {', '  try {', '    const __sim_result = await (async () => {'
const E2B_PYTHON_WRAPPER_LINES = 1 // Lines before user code: 'def __sim_main__():'

type TypeScriptModule = typeof import('typescript')

let typescriptModulePromise: Promise<TypeScriptModule> | null = null

async function loadTypeScriptModule(): Promise<TypeScriptModule> {
  if (!typescriptModulePromise) {
    typescriptModulePromise = import('typescript').then((mod) => {
      const tsModule = (mod?.default ?? mod) as TypeScriptModule
      return tsModule
    })
  }

  return typescriptModulePromise
}

async function extractJavaScriptImports(
  code: string
): Promise<{ imports: string; remainingCode: string; importLineCount: number }> {
  try {
    const tsModule = await loadTypeScriptModule()

    const sourceFile = tsModule.createSourceFile(
      'user-code.js',
      code,
      tsModule.ScriptTarget.Latest,
      true,
      tsModule.ScriptKind.JS
    )

    const importSegments: Array<{ text: string; start: number; end: number }> = []

    sourceFile.statements.forEach((statement) => {
      if (
        tsModule.isImportDeclaration(statement) ||
        tsModule.isImportEqualsDeclaration(statement)
      ) {
        importSegments.push({
          text: statement.getFullText(sourceFile).trim(),
          start: statement.getFullStart(),
          end: statement.getEnd(),
        })
      }
    })

    if (importSegments.length === 0) {
      return { imports: '', remainingCode: code, importLineCount: 0 }
    }

    importSegments.sort((a, b) => a.start - b.start)

    const imports = importSegments.map((segment) => segment.text).join('\n')

    let cursor = 0
    const parts: string[] = []
    let importLineCount = 0

    for (const segment of importSegments) {
      if (segment.start > cursor) {
        parts.push(code.slice(cursor, segment.start))
      }

      const removedSegment = code.slice(segment.start, segment.end)
      importLineCount += removedSegment.split('\n').length - 1

      const newlinePlaceholder = removedSegment.replace(/[^\n]/g, '')
      parts.push(newlinePlaceholder)

      cursor = segment.end
    }

    if (cursor < code.length) {
      parts.push(code.slice(cursor))
    }

    const remainingCode = parts.join('')

    return { imports, remainingCode, importLineCount: Math.max(importLineCount, 0) }
  } catch (error) {
    logger.error('Failed to extract JavaScript imports', { error })
    return { imports: '', remainingCode: code, importLineCount: 0 }
  }
}

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
 * Parse and format E2B error message
 * Removes E2B-specific line references and adds correct user line numbers
 */
function formatE2BError(
  errorMessage: string,
  errorOutput: string,
  language: CodeLanguage,
  userCode: string,
  prologueLineCount: number
): { formattedError: string; cleanedOutput: string } {
  // Calculate line offset based on language and prologue
  const wrapperLines =
    language === CodeLanguage.Python ? E2B_PYTHON_WRAPPER_LINES : E2B_JS_WRAPPER_LINES
  const totalOffset = prologueLineCount + wrapperLines

  let userLine: number | undefined
  let cleanErrorType = ''
  let cleanErrorMsg = ''

  if (language === CodeLanguage.Python) {
    // Python error format: "Cell In[X], line Y" followed by error details
    // Extract line number from the Cell reference
    const cellMatch = errorOutput.match(/Cell In\[\d+\], line (\d+)/)
    if (cellMatch) {
      const originalLine = Number.parseInt(cellMatch[1], 10)
      userLine = originalLine - totalOffset
    }

    // Extract clean error message from the error string
    // Remove file references like "(detected at line X) (file.py, line Y)"
    cleanErrorMsg = errorMessage
      .replace(/\s*\(detected at line \d+\)/g, '')
      .replace(/\s*\([^)]+\.py, line \d+\)/g, '')
      .trim()
  } else if (language === CodeLanguage.JavaScript) {
    // JavaScript error format from E2B: "SyntaxError: /path/file.ts: Message. (line:col)\n\n   9 | ..."
    // First, extract the error type and message from the first line
    const firstLineEnd = errorMessage.indexOf('\n')
    const firstLine = firstLineEnd > 0 ? errorMessage.substring(0, firstLineEnd) : errorMessage

    // Parse: "SyntaxError: /home/user/index.ts: Missing semicolon. (11:9)"
    const jsErrorMatch = firstLine.match(/^(\w+Error):\s*[^:]+:\s*([^(]+)\.\s*\((\d+):(\d+)\)/)
    if (jsErrorMatch) {
      cleanErrorType = jsErrorMatch[1]
      cleanErrorMsg = jsErrorMatch[2].trim()
      const originalLine = Number.parseInt(jsErrorMatch[3], 10)
      userLine = originalLine - totalOffset
    } else {
      // Fallback: look for line number in the arrow pointer line (> 11 |)
      const arrowMatch = errorMessage.match(/^>\s*(\d+)\s*\|/m)
      if (arrowMatch) {
        const originalLine = Number.parseInt(arrowMatch[1], 10)
        userLine = originalLine - totalOffset
      }
      // Try to extract error type and message
      const errorMatch = firstLine.match(/^(\w+Error):\s*(.+)/)
      if (errorMatch) {
        cleanErrorType = errorMatch[1]
        cleanErrorMsg = errorMatch[2]
          .replace(/^[^:]+:\s*/, '') // Remove file path
          .replace(/\s*\(\d+:\d+\)\s*$/, '') // Remove line:col at end
          .trim()
      } else {
        cleanErrorMsg = firstLine
      }
    }
  }

  // Build the final clean error message
  const finalErrorMsg =
    cleanErrorType && cleanErrorMsg
      ? `${cleanErrorType}: ${cleanErrorMsg}`
      : cleanErrorMsg || errorMessage

  // Format with line number if available
  let formattedError = finalErrorMsg
  if (userLine && userLine > 0) {
    const codeLines = userCode.split('\n')
    // Clamp userLine to the actual user code range
    const actualUserLine = Math.min(userLine, codeLines.length)
    if (actualUserLine > 0 && actualUserLine <= codeLines.length) {
      const lineContent = codeLines[actualUserLine - 1]?.trim()
      if (lineContent) {
        formattedError = `Line ${actualUserLine}: \`${lineContent}\` - ${finalErrorMsg}`
      } else {
        formattedError = `Line ${actualUserLine} - ${finalErrorMsg}`
      }
    }
  }

  // For stdout, just return the clean error message without the full traceback
  const cleanedOutput = finalErrorMsg

  return { formattedError, cleanedOutput }
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

  // Add line information if available
  if (enhanced.line !== undefined) {
    let lineInfo = `Line ${enhanced.line}`

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
        let lineInfo = `Line ${line}`

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

  const regex = createWorkflowVariablePattern()
  let match: RegExpExecArray | null
  const replacements: Array<{
    match: string
    index: number
    variableName: string
    variableValue: unknown
  }> = []

  while ((match = regex.exec(code)) !== null) {
    const variableName = match[1].trim()

    // Find the variable by name (workflowVariables is indexed by ID, values are variable objects)
    const foundVariable = Object.entries(workflowVariables).find(
      ([_, variable]) => normalizeName(variable.name || '') === variableName
    )

    let variableValue: unknown = ''
    if (foundVariable) {
      const variable = foundVariable[1]
      variableValue = variable.value

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
        } catch {
          // Fallback to original value on error
          variableValue = variable.value
        }
      }
    }

    replacements.push({
      match: match[0],
      index: match.index,
      variableName,
      variableValue,
    })
  }

  // Process replacements in reverse order to maintain correct indices
  for (let i = replacements.length - 1; i >= 0; i--) {
    const { match: matchStr, index, variableName, variableValue } = replacements[i]

    // Use variable reference approach
    const safeVarName = `__variable_${variableName.replace(/[^a-zA-Z0-9_]/g, '_')}`
    contextVariables[safeVarName] = variableValue
    resolvedCode =
      resolvedCode.slice(0, index) + safeVarName + resolvedCode.slice(index + matchStr.length)
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

  const regex = createEnvVarPattern()
  let match: RegExpExecArray | null
  const replacements: Array<{ match: string; index: number; varName: string; varValue: string }> =
    []

  while ((match = regex.exec(code)) !== null) {
    const varName = match[1].trim()
    const varValue = envVars[varName] || params[varName] || ''
    replacements.push({
      match: match[0],
      index: match.index,
      varName,
      varValue: String(varValue),
    })
  }

  for (let i = replacements.length - 1; i >= 0; i--) {
    const { match: matchStr, index, varName, varValue } = replacements[i]

    const safeVarName = `__var_${varName.replace(/[^a-zA-Z0-9_]/g, '_')}`
    contextVariables[safeVarName] = varValue
    resolvedCode =
      resolvedCode.slice(0, index) + safeVarName + resolvedCode.slice(index + matchStr.length)
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

  const tagPattern = new RegExp(
    `${REFERENCE.START}([a-zA-Z_][a-zA-Z0-9_${REFERENCE.PATH_DELIMITER}]*[a-zA-Z0-9_])${REFERENCE.END}`,
    'g'
  )
  const tagMatches = resolvedCode.match(tagPattern) || []

  for (const match of tagMatches) {
    const tagName = match.slice(REFERENCE.START.length, -REFERENCE.END.length).trim()

    // Handle nested paths like "getrecord.response.data" or "function1.response.result"
    // First try params, then blockData directly, then try with block name mapping
    let tagValue = getNestedValue(params, tagName) || getNestedValue(blockData, tagName) || ''

    // If not found and the path starts with a block name, try mapping the block name to ID
    if (!tagValue && tagName.includes(REFERENCE.PATH_DELIMITER)) {
      const pathParts = tagName.split(REFERENCE.PATH_DELIMITER)
      const normalizedBlockName = pathParts[0] // This should already be normalized like "function1"

      // Direct lookup using normalized block name
      const blockId = blockNameMapping[normalizedBlockName] ?? null

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
 * Remove one trailing newline from stdout
 * This handles the common case where print() or console.log() adds a trailing \n
 * that users don't expect to see in the output
 */
function cleanStdout(stdout: string): string {
  if (stdout.endsWith('\n')) {
    return stdout.slice(0, -1)
  }
  return stdout
}

export async function POST(req: NextRequest) {
  const requestId = generateRequestId()
  const startTime = Date.now()
  let stdout = ''
  let userCodeStartLine = 3 // Default value for error reporting
  let resolvedCode = '' // Store resolved code for error reporting

  try {
    const body = await req.json()

    const { DEFAULT_EXECUTION_TIMEOUT_MS } = await import('@/lib/execution/constants')

    const {
      code,
      params = {},
      timeout = DEFAULT_EXECUTION_TIMEOUT_MS,
      language = DEFAULT_CODE_LANGUAGE,
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

    const lang = isValidCodeLanguage(language) ? language : DEFAULT_CODE_LANGUAGE

    // Extract imports once for JavaScript code (reuse later to avoid double extraction)
    let jsImports = ''
    let jsRemainingCode = resolvedCode
    let hasImports = false

    if (lang === CodeLanguage.JavaScript) {
      const extractionResult = await extractJavaScriptImports(resolvedCode)
      jsImports = extractionResult.imports
      jsRemainingCode = extractionResult.remainingCode

      // Check for ES6 imports or CommonJS require statements
      // ES6 imports are extracted by the TypeScript parser
      // Also check for require() calls which indicate external dependencies
      const hasRequireStatements = /require\s*\(\s*['"`]/.test(resolvedCode)
      hasImports = jsImports.trim().length > 0 || hasRequireStatements
    }

    // Python always requires E2B
    if (lang === CodeLanguage.Python && !isE2bEnabled) {
      throw new Error(
        'Python execution requires E2B to be enabled. Please contact your administrator to enable E2B, or use JavaScript instead.'
      )
    }

    // JavaScript with imports requires E2B
    if (lang === CodeLanguage.JavaScript && hasImports && !isE2bEnabled) {
      throw new Error(
        'JavaScript code with import statements requires E2B to be enabled. Please remove the import statements, or contact your administrator to enable E2B.'
      )
    }

    // Use E2B if:
    // - E2B is enabled AND
    // - Not a custom tool AND
    // - (Python OR JavaScript with imports)
    const useE2B =
      isE2bEnabled &&
      !isCustomTool &&
      (lang === CodeLanguage.Python || (lang === CodeLanguage.JavaScript && hasImports))

    if (useE2B) {
      logger.info(`[${requestId}] E2B status`, {
        enabled: isE2bEnabled,
        hasApiKey: Boolean(process.env.E2B_API_KEY),
        language: lang,
      })
      let prologue = ''
      const epilogue = ''

      if (lang === CodeLanguage.JavaScript) {
        // Track prologue lines for error adjustment
        let prologueLineCount = 0

        // Reuse the imports we already extracted earlier
        const imports = jsImports
        const remainingCode = jsRemainingCode

        const importSection: string = imports ? `${imports}\n` : ''
        const importLineCount = imports ? imports.split('\n').length : 0

        const codeBody = remainingCode
        resolvedCode = importSection ? `${imports}\n\n${codeBody}` : codeBody

        prologue += `const params = JSON.parse(${JSON.stringify(JSON.stringify(executionParams))});\n`
        prologueLineCount++
        prologue += `const environmentVariables = JSON.parse(${JSON.stringify(JSON.stringify(envVars))});\n`
        prologueLineCount++
        for (const [k, v] of Object.entries(contextVariables)) {
          prologue += `const ${k} = JSON.parse(${JSON.stringify(JSON.stringify(v))});\n`
          prologueLineCount++
        }

        const wrapped = [
          ';(async () => {',
          '  try {',
          '    const __sim_result = await (async () => {',
          `      ${codeBody.split('\n').join('\n      ')}`,
          '    })();',
          "    console.log('__SIM_RESULT__=' + JSON.stringify(__sim_result));",
          '  } catch (error) {',
          '    console.log(String((error && (error.stack || error.message)) || error));',
          '    throw error;',
          '  }',
          '})();',
        ].join('\n')
        const codeForE2B = importSection + prologue + wrapped + epilogue

        const execStart = Date.now()
        const {
          result: e2bResult,
          stdout: e2bStdout,
          sandboxId,
          error: e2bError,
        } = await executeInE2B({
          code: codeForE2B,
          language: CodeLanguage.JavaScript,
          timeoutMs: timeout,
        })
        const executionTime = Date.now() - execStart
        stdout += e2bStdout

        logger.info(`[${requestId}] E2B JS sandbox`, {
          sandboxId,
          stdoutPreview: e2bStdout?.slice(0, 200),
          error: e2bError,
        })

        // If there was an execution error, format it properly
        if (e2bError) {
          const { formattedError, cleanedOutput } = formatE2BError(
            e2bError,
            e2bStdout,
            lang,
            resolvedCode,
            prologueLineCount + importLineCount
          )
          return NextResponse.json(
            {
              success: false,
              error: formattedError,
              output: { result: null, stdout: cleanedOutput, executionTime },
            },
            { status: 500 }
          )
        }

        return NextResponse.json({
          success: true,
          output: { result: e2bResult ?? null, stdout: cleanStdout(stdout), executionTime },
        })
      }
      // Track prologue lines for error adjustment
      let prologueLineCount = 0
      prologue += 'import json\n'
      prologueLineCount++
      prologue += `params = json.loads(${JSON.stringify(JSON.stringify(executionParams))})\n`
      prologueLineCount++
      prologue += `environmentVariables = json.loads(${JSON.stringify(JSON.stringify(envVars))})\n`
      prologueLineCount++
      for (const [k, v] of Object.entries(contextVariables)) {
        prologue += `${k} = json.loads(${JSON.stringify(JSON.stringify(v))})\n`
        prologueLineCount++
      }
      const wrapped = [
        'def __sim_main__():',
        ...resolvedCode.split('\n').map((l) => `    ${l}`),
        '__sim_result__ = __sim_main__()',
        "print('__SIM_RESULT__=' + json.dumps(__sim_result__))",
      ].join('\n')
      const codeForE2B = prologue + wrapped + epilogue

      const execStart = Date.now()
      const {
        result: e2bResult,
        stdout: e2bStdout,
        sandboxId,
        error: e2bError,
      } = await executeInE2B({
        code: codeForE2B,
        language: CodeLanguage.Python,
        timeoutMs: timeout,
      })
      const executionTime = Date.now() - execStart
      stdout += e2bStdout

      logger.info(`[${requestId}] E2B Py sandbox`, {
        sandboxId,
        stdoutPreview: e2bStdout?.slice(0, 200),
        error: e2bError,
      })

      // If there was an execution error, format it properly
      if (e2bError) {
        const { formattedError, cleanedOutput } = formatE2BError(
          e2bError,
          e2bStdout,
          lang,
          resolvedCode,
          prologueLineCount
        )
        return NextResponse.json(
          {
            success: false,
            error: formattedError,
            output: { result: null, stdout: cleanedOutput, executionTime },
          },
          { status: 500 }
        )
      }

      return NextResponse.json({
        success: true,
        output: { result: e2bResult ?? null, stdout: cleanStdout(stdout), executionTime },
      })
    }

    const executionMethod = 'isolated-vm'

    const wrapperLines = ['(async () => {', '  try {']
    if (isCustomTool) {
      wrapperLines.push('    // For custom tools, make parameters directly accessible')
      Object.keys(executionParams).forEach((key) => {
        wrapperLines.push(`    const ${key} = params.${key};`)
      })
    }
    userCodeStartLine = wrapperLines.length + 1

    let codeToExecute = resolvedCode
    let prependedLineCount = 0
    if (isCustomTool) {
      const paramKeys = Object.keys(executionParams)
      const paramDestructuring = paramKeys.map((key) => `const ${key} = params.${key};`).join('\n')
      codeToExecute = `${paramDestructuring}\n${resolvedCode}`
      prependedLineCount = paramKeys.length
    }

    const isolatedResult = await executeInIsolatedVM({
      code: codeToExecute,
      params: executionParams,
      envVars,
      contextVariables,
      timeoutMs: timeout,
      requestId,
    })

    const executionTime = Date.now() - startTime

    if (isolatedResult.error) {
      logger.error(`[${requestId}] Function execution failed in isolated-vm`, {
        error: isolatedResult.error,
        executionTime,
      })

      const ivmError = isolatedResult.error
      // Adjust line number for prepended param destructuring in custom tools
      let adjustedLine = ivmError.line
      let adjustedLineContent = ivmError.lineContent
      if (prependedLineCount > 0 && ivmError.line !== undefined) {
        adjustedLine = Math.max(1, ivmError.line - prependedLineCount)
        // Get line content from original user code, not the prepended code
        const codeLines = resolvedCode.split('\n')
        if (adjustedLine <= codeLines.length) {
          adjustedLineContent = codeLines[adjustedLine - 1]?.trim()
        }
      }
      const enhancedError: EnhancedError = {
        message: ivmError.message,
        name: ivmError.name,
        stack: ivmError.stack,
        originalError: ivmError,
        line: adjustedLine,
        column: ivmError.column,
        lineContent: adjustedLineContent,
      }

      const userFriendlyErrorMessage = createUserFriendlyErrorMessage(
        enhancedError,
        requestId,
        resolvedCode
      )

      logger.error(`[${requestId}] Enhanced error details`, {
        originalMessage: ivmError.message,
        enhancedMessage: userFriendlyErrorMessage,
        line: enhancedError.line,
        column: enhancedError.column,
        lineContent: enhancedError.lineContent,
        errorType: enhancedError.name,
      })

      return NextResponse.json(
        {
          success: false,
          error: userFriendlyErrorMessage,
          output: {
            result: null,
            stdout: cleanStdout(isolatedResult.stdout),
            executionTime,
          },
          debug: {
            line: enhancedError.line,
            column: enhancedError.column,
            errorType: enhancedError.name,
            lineContent: enhancedError.lineContent,
            stack: enhancedError.stack,
          },
        },
        { status: 500 }
      )
    }

    stdout = isolatedResult.stdout
    logger.info(`[${requestId}] Function executed successfully using ${executionMethod}`, {
      executionTime,
    })

    return NextResponse.json({
      success: true,
      output: { result: isolatedResult.result, stdout: cleanStdout(stdout), executionTime },
    })
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
        stdout: cleanStdout(stdout),
        executionTime,
      },
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
