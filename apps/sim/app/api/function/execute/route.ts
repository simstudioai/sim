import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { functionExecuteContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  FORMAT_TO_CONTENT_TYPE,
  normalizeOutputWorkspaceFileName,
  resolveOutputFormat,
} from '@/lib/copilot/request/tools/files'
import { isE2bEnabled } from '@/lib/core/config/feature-flags'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { executeInE2B, executeShellInE2B } from '@/lib/execution/e2b'
import { executeInIsolatedVM } from '@/lib/execution/isolated-vm'
import { CodeLanguage, DEFAULT_CODE_LANGUAGE, isValidCodeLanguage } from '@/lib/execution/languages'
import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { getWorkflowById } from '@/lib/workflows/utils'
import { escapeRegExp, normalizeName, REFERENCE } from '@/executor/constants'
import { type OutputSchema, resolveBlockReference } from '@/executor/utils/block-reference'
import { formatLiteralForCode } from '@/executor/utils/code-formatting'
import {
  createEnvVarPattern,
  createReferencePattern,
  createWorkflowVariablePattern,
} from '@/executor/utils/reference-validation'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const logger = createLogger('FunctionExecuteAPI')

const TAG_PATTERN = createReferencePattern()

const E2B_JS_WRAPPER_LINES = 3
const E2B_PYTHON_WRAPPER_LINES = 1

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

    const stackLines: string[] = error.stack.split('\n')

    for (const line of stackLines) {
      let match = line.match(/user-function\.js:(\d+)(?::(\d+))?/)

      if (!match) {
        match = line.match(/at\s+user-function\.js:(\d+):(\d+)/)
      }

      if (match) {
        const stackLine = Number.parseInt(match[1], 10)
        const stackColumn = match[2] ? Number.parseInt(match[2], 10) : undefined

        const adjustedLine = stackLine - userCodeStartLine + 1

        const isWrapperSyntaxError =
          stackLine > userCodeStartLine &&
          error.name === 'SyntaxError' &&
          (error.message.includes('Unexpected token') ||
            error.message.includes('Unexpected end of input'))

        if (isWrapperSyntaxError && userCode) {
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

          if (userCode) {
            const codeLines = userCode.split('\n')
            if (adjustedLine <= codeLines.length) {
              enhanced.lineContent = codeLines[adjustedLine - 1]?.trim()
            }
          }
          break
        }

        if (stackLine <= userCodeStartLine) {
          enhanced.line = stackLine
          enhanced.column = stackColumn
          break
        }
      }
    }

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
  const wrapperLines =
    language === CodeLanguage.Python ? E2B_PYTHON_WRAPPER_LINES : E2B_JS_WRAPPER_LINES
  const totalOffset = prologueLineCount + wrapperLines

  let userLine: number | undefined
  let cleanErrorType = ''
  let cleanErrorMsg = ''

  if (language === CodeLanguage.Python) {
    const cellMatch = errorOutput.match(/Cell In\[\d+\], line (\d+)/)
    if (cellMatch) {
      const originalLine = Number.parseInt(cellMatch[1], 10)
      userLine = originalLine - totalOffset
    }

    cleanErrorMsg = errorMessage
      .replace(/\s*\(detected at line \d+\)/g, '')
      .replace(/\s*\([^)]+\.py, line \d+\)/g, '')
      .trim()
  } else if (language === CodeLanguage.JavaScript) {
    const firstLineEnd = errorMessage.indexOf('\n')
    const firstLine = firstLineEnd > 0 ? errorMessage.substring(0, firstLineEnd) : errorMessage

    const jsErrorMatch = firstLine.match(/^(\w+Error):\s*[^:]+:\s*([^(]+)\.\s*\((\d+):(\d+)\)/)
    if (jsErrorMatch) {
      cleanErrorType = jsErrorMatch[1]
      cleanErrorMsg = jsErrorMatch[2].trim()
      const originalLine = Number.parseInt(jsErrorMatch[3], 10)
      userLine = originalLine - totalOffset
    } else {
      const arrowMatch = errorMessage.match(/^>\s*(\d+)\s*\|/m)
      if (arrowMatch) {
        const originalLine = Number.parseInt(arrowMatch[1], 10)
        userLine = originalLine - totalOffset
      }
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

  const finalErrorMsg =
    cleanErrorType && cleanErrorMsg
      ? `${cleanErrorType}: ${cleanErrorMsg}`
      : cleanErrorMsg || errorMessage

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

  if (enhanced.line !== undefined) {
    let lineInfo = `Line ${enhanced.line}`

    // Add the actual line content if available
    if (enhanced.lineContent) {
      lineInfo += `: \`${enhanced.lineContent}\``
    }

    errorMessage = `${lineInfo} - ${errorMessage}`
  } else {
    if (enhanced.stack) {
      const stackMatch = enhanced.stack.match(/user-function\.js:(\d+)(?::(\d+))?/)
      if (stackMatch) {
        const line = Number.parseInt(stackMatch[1], 10)
        let lineInfo = `Line ${line}`

        if (userCode) {
          const codeLines = userCode.split('\n')
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

  if (enhanced.name !== 'Error') {
    const errorTypePrefix =
      enhanced.name === 'SyntaxError'
        ? 'Syntax Error'
        : enhanced.name === 'TypeError'
          ? 'Type Error'
          : enhanced.name === 'ReferenceError'
            ? 'Reference Error'
            : enhanced.name

    if (!errorMessage.toLowerCase().includes(errorTypePrefix.toLowerCase())) {
      errorMessage = `${errorTypePrefix}: ${errorMessage}`
    }
  }

  return errorMessage
}

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

    const foundVariable = Object.entries(workflowVariables).find(
      ([_, variable]) => normalizeName(variable.name || '') === variableName
    )

    if (!foundVariable) {
      const availableVars = Object.values(workflowVariables)
        .map((v) => v.name)
        .filter(Boolean)
      throw new Error(
        `Variable "${variableName}" doesn't exist.` +
          (availableVars.length > 0 ? ` Available: ${availableVars.join(', ')}` : '')
      )
    }

    const variable = foundVariable[1]
    let variableValue: unknown = variable.value

    if (variable.value !== undefined && variable.value !== null) {
      const type = variable.type === 'string' ? 'plain' : variable.type

      if (type === 'number') {
        variableValue = Number(variableValue)
      } else if (type === 'boolean') {
        if (typeof variableValue === 'boolean') {
          // Already a boolean, keep as-is
        } else {
          const normalized = String(variableValue).toLowerCase().trim()
          variableValue = normalized === 'true'
        }
      } else if (type === 'json' && typeof variableValue === 'string') {
        try {
          variableValue = JSON.parse(variableValue)
        } catch {
          // Keep as-is
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

  for (let i = replacements.length - 1; i >= 0; i--) {
    const { match: matchStr, index, variableName, variableValue } = replacements[i]

    const safeVarName = `__variable_${variableName.replace(/[^a-zA-Z0-9_]/g, '_')}`
    contextVariables[safeVarName] = variableValue
    resolvedCode =
      resolvedCode.slice(0, index) + safeVarName + resolvedCode.slice(index + matchStr.length)
  }

  return resolvedCode
}

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

  const resolverVars: Record<string, string> = {}
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      resolverVars[key] = String(value)
    }
  })
  Object.entries(envVars).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      resolverVars[key] = value
    }
  })

  while ((match = regex.exec(code)) !== null) {
    const varName = match[1].trim()

    if (!(varName in resolverVars)) {
      continue
    }

    replacements.push({
      match: match[0],
      index: match.index,
      varName,
      varValue: resolverVars[varName],
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

function resolveTagVariables(
  code: string,
  blockData: Record<string, unknown>,
  blockNameMapping: Record<string, string>,
  blockOutputSchemas: Record<string, OutputSchema>,
  contextVariables: Record<string, unknown>,
  language = 'javascript'
): string {
  let resolvedCode = code
  const undefinedLiteral = language === 'python' ? 'None' : 'undefined'

  const tagMatches = resolvedCode.match(TAG_PATTERN) || []

  for (const match of tagMatches) {
    const tagName = match.slice(REFERENCE.START.length, -REFERENCE.END.length).trim()
    const pathParts = tagName.split(REFERENCE.PATH_DELIMITER)
    const blockName = pathParts[0]
    const fieldPath = pathParts.slice(1)

    const result = resolveBlockReference(blockName, fieldPath, {
      blockNameMapping,
      blockData,
      blockOutputSchemas,
    })

    if (!result) {
      continue
    }

    let tagValue = result.value

    if (tagValue === undefined) {
      resolvedCode = resolvedCode.replace(new RegExp(escapeRegExp(match), 'g'), undefinedLiteral)
      continue
    }

    if (typeof tagValue === 'string') {
      const trimmed = tagValue.trimStart()
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          tagValue = JSON.parse(tagValue)
        } catch {
          // Keep as string if not valid JSON
        }
      }
    }

    const safeVarName = `__tag_${tagName.replace(/_/g, '_1').replace(/\./g, '_0')}`
    contextVariables[safeVarName] = tagValue
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
  params: Record<string, unknown>,
  envVars: Record<string, string> = {},
  blockData: Record<string, unknown> = {},
  blockNameMapping: Record<string, string> = {},
  blockOutputSchemas: Record<string, OutputSchema> = {},
  workflowVariables: Record<string, unknown> = {},
  language = 'javascript'
): { resolvedCode: string; contextVariables: Record<string, unknown> } {
  let resolvedCode = code
  const contextVariables: Record<string, unknown> = {}

  resolvedCode = resolveWorkflowVariables(resolvedCode, workflowVariables, contextVariables)
  resolvedCode = resolveEnvironmentVariables(resolvedCode, params, envVars, contextVariables)
  resolvedCode = resolveTagVariables(
    resolvedCode,
    blockData,
    blockNameMapping,
    blockOutputSchemas,
    contextVariables,
    language
  )

  return { resolvedCode, contextVariables }
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

/**
 * Serializes a value for use as a shell environment variable. Strings pass through
 * unchanged; primitives are coerced via `String`; objects, arrays, and other complex
 * values are JSON-stringified so that referencing them via `$VAR` yields a useful
 * representation instead of `[object Object]`. `null`/`undefined` become an empty
 * string to match POSIX env semantics.
 */
function serializeForShellEnv(value: unknown, nullValue = ''): string {
  if (value === null || value === undefined) return nullValue
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return String(value)
  }
}

async function maybeExportSandboxFileToWorkspace(args: {
  authUserId: string
  workflowId?: string
  workspaceId?: string
  outputPath?: string
  outputFormat?: string
  outputMimeType?: string
  outputSandboxPath?: string
  exportedFileContent?: string
  stdout: string
  executionTime: number
}) {
  const {
    authUserId,
    workflowId,
    workspaceId,
    outputPath,
    outputFormat,
    outputMimeType,
    outputSandboxPath,
    exportedFileContent,
    stdout,
    executionTime,
  } = args

  if (!outputSandboxPath) return null

  if (!outputPath) {
    return NextResponse.json(
      {
        success: false,
        error:
          'outputSandboxPath requires outputPath. Set outputPath to the destination workspace file, e.g. "files/result.csv".',
        output: { result: null, stdout: cleanStdout(stdout), executionTime },
      },
      { status: 400 }
    )
  }

  const resolvedWorkspaceId =
    workspaceId || (workflowId ? (await getWorkflowById(workflowId))?.workspaceId : undefined)

  if (!resolvedWorkspaceId) {
    return NextResponse.json(
      {
        success: false,
        error: 'Workspace context required to save sandbox file to workspace',
        output: { result: null, stdout: cleanStdout(stdout), executionTime },
      },
      { status: 400 }
    )
  }

  if (exportedFileContent === undefined) {
    return NextResponse.json(
      {
        success: false,
        error: `Sandbox file "${outputSandboxPath}" was not found or could not be read`,
        output: { result: null, stdout: cleanStdout(stdout), executionTime },
      },
      { status: 500 }
    )
  }

  const fileName = normalizeOutputWorkspaceFileName(outputPath)

  const TEXT_MIMES = new Set(Object.values(FORMAT_TO_CONTENT_TYPE))
  const resolvedMimeType =
    outputMimeType ||
    FORMAT_TO_CONTENT_TYPE[resolveOutputFormat(fileName, outputFormat)] ||
    'application/octet-stream'
  const isBinary = !TEXT_MIMES.has(resolvedMimeType)
  const fileBuffer = isBinary
    ? Buffer.from(exportedFileContent, 'base64')
    : Buffer.from(exportedFileContent, 'utf-8')

  const uploaded = await uploadWorkspaceFile(
    resolvedWorkspaceId,
    authUserId,
    fileBuffer,
    fileName,
    resolvedMimeType
  )

  return NextResponse.json({
    success: true,
    output: {
      result: {
        message: `Sandbox file exported to files/${fileName}`,
        fileId: uploaded.id,
        fileName,
        downloadUrl: uploaded.url,
        sandboxPath: outputSandboxPath,
      },
      stdout: cleanStdout(stdout),
      executionTime,
    },
    resources: [{ type: 'file', id: uploaded.id, title: fileName }],
  })
}

export const POST = withRouteHandler(async (req: NextRequest) => {
  const requestId = generateRequestId()
  const startTime = Date.now()
  let stdout = ''
  let userCodeStartLine = 3 // Default value for error reporting
  let resolvedCode = '' // Store resolved code for error reporting

  try {
    const auth = await checkInternalAuth(req)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized function execution attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(functionExecuteContract, req, {})
    if (!parsed.success) return parsed.response
    const { body } = parsed.data

    const { DEFAULT_EXECUTION_TIMEOUT_MS } = await import('@/lib/execution/constants')

    const {
      code,
      params = {},
      timeout = DEFAULT_EXECUTION_TIMEOUT_MS,
      language = DEFAULT_CODE_LANGUAGE,
      outputPath,
      outputFormat,
      outputMimeType,
      outputSandboxPath,
      envVars = {},
      blockData = {},
      blockNameMapping = {},
      blockOutputSchemas = {},
      workflowVariables = {},
      contextVariables: preResolvedContextVariables = {},
      workflowId,
      workspaceId,
      isCustomTool = false,
      _sandboxFiles,
    } = body

    const executionParams = { ...params }
    executionParams._context = undefined

    logger.info(`[${requestId}] Function execution request`, {
      hasCode: !!code,
      paramsCount: Object.keys(executionParams).length,
      timeout,
      workflowId,
      isCustomTool,
    })

    const lang = isValidCodeLanguage(language) ? language : DEFAULT_CODE_LANGUAGE

    let contextVariables: Record<string, unknown> = {}
    if (lang === CodeLanguage.Shell) {
      // For shell, env vars are injected as OS env vars via shellEnvs.
      // Replace {{VAR}} placeholders with $VAR so the shell can access them natively.
      resolvedCode = code.replace(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g, '$$$1')
      // Carry pre-resolved block output variables (e.g. __blockRef_N) so they can be
      // injected as shell env vars below. The executor replaces block references in the
      // code with these names, so the values must be present at runtime.
      contextVariables = { ...preResolvedContextVariables }
    } else {
      const codeResolution = resolveCodeVariables(
        code,
        executionParams,
        envVars,
        blockData,
        blockNameMapping,
        blockOutputSchemas,
        workflowVariables,
        lang
      )
      resolvedCode = codeResolution.resolvedCode
      // Merge pre-resolved block output variables from the executor. These take precedence
      // because they were produced by the resolver using full execution-state context
      // (including loop/parallel scope) and should not be overwritten.
      contextVariables = { ...codeResolution.contextVariables, ...preResolvedContextVariables }
    }

    let jsImports = ''
    let jsRemainingCode = resolvedCode
    let hasImports = false

    if (lang === CodeLanguage.JavaScript) {
      const extractionResult = await extractJavaScriptImports(resolvedCode)
      jsImports = extractionResult.imports
      jsRemainingCode = extractionResult.remainingCode

      const hasRequireStatements = /require\s*\(\s*['"`]/.test(resolvedCode)
      hasImports = jsImports.trim().length > 0 || hasRequireStatements
    }

    if (lang === CodeLanguage.Shell) {
      if (!isE2bEnabled) {
        throw new Error(
          'Shell execution requires E2B to be enabled. Please contact your administrator to enable E2B.'
        )
      }

      const shellEnvs: Record<string, string> = {}
      for (const [k, v] of Object.entries(envVars)) {
        shellEnvs[k] = serializeForShellEnv(v)
      }
      for (const [k, v] of Object.entries(contextVariables)) {
        shellEnvs[k] = serializeForShellEnv(v, 'null')
      }

      logger.info(`[${requestId}] E2B shell execution`, {
        enabled: isE2bEnabled,
        hasApiKey: Boolean(process.env.E2B_API_KEY),
        envVarCount: Object.keys(shellEnvs).length,
      })

      const execStart = Date.now()
      const {
        result: shellResult,
        stdout: shellStdout,
        sandboxId,
        error: shellError,
        exportedFileContent,
      } = await executeShellInE2B({
        code: resolvedCode,
        envs: shellEnvs,
        timeoutMs: timeout,
        sandboxFiles: _sandboxFiles,
        outputSandboxPath,
      })
      const executionTime = Date.now() - execStart

      logger.info(`[${requestId}] E2B shell sandbox`, {
        sandboxId,
        stdoutPreview: shellStdout?.slice(0, 200),
        error: shellError,
        executionTime,
      })

      if (shellError) {
        return NextResponse.json(
          {
            success: false,
            error: shellError,
            output: { result: null, stdout: cleanStdout(shellStdout), executionTime },
          },
          { status: 500 }
        )
      }

      if (outputSandboxPath) {
        const fileExportResponse = await maybeExportSandboxFileToWorkspace({
          authUserId: auth.userId,
          workflowId,
          workspaceId,
          outputPath,
          outputFormat,
          outputMimeType,
          outputSandboxPath,
          exportedFileContent,
          stdout: shellStdout,
          executionTime,
        })
        if (fileExportResponse) return fileExportResponse
      }

      return NextResponse.json({
        success: true,
        output: { result: shellResult ?? null, stdout: cleanStdout(shellStdout), executionTime },
      })
    }

    if (lang === CodeLanguage.Python && !isE2bEnabled) {
      throw new Error(
        'Python execution requires E2B to be enabled. Please contact your administrator to enable E2B, or use JavaScript instead.'
      )
    }

    if (lang === CodeLanguage.JavaScript && hasImports && !isE2bEnabled) {
      throw new Error(
        'JavaScript code with import statements requires E2B to be enabled. Please remove the import statements, or contact your administrator to enable E2B.'
      )
    }

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

      if (lang === CodeLanguage.JavaScript) {
        let prologueLineCount = 0

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
          prologue += `globalThis[${JSON.stringify(k)}] = ${formatLiteralForCode(v, 'javascript')};\n`
          prologue += `const ${k} = globalThis[${JSON.stringify(k)}];\n`
          prologueLineCount++
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
        const codeForE2B = importSection + prologue + wrapped

        const execStart = Date.now()
        const {
          result: e2bResult,
          stdout: e2bStdout,
          sandboxId,
          error: e2bError,
          exportedFileContent,
        } = await executeInE2B({
          code: codeForE2B,
          language: CodeLanguage.JavaScript,
          timeoutMs: timeout,
          sandboxFiles: _sandboxFiles,
          outputSandboxPath,
        })
        const executionTime = Date.now() - execStart
        stdout += e2bStdout

        logger.info(`[${requestId}] E2B JS sandbox`, {
          sandboxId,
          stdoutPreview: e2bStdout?.slice(0, 200),
          error: e2bError,
        })

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

        if (outputSandboxPath) {
          const fileExportResponse = await maybeExportSandboxFileToWorkspace({
            authUserId: auth.userId,
            workflowId,
            workspaceId,
            outputPath,
            outputFormat,
            outputMimeType,
            outputSandboxPath,
            exportedFileContent,
            stdout,
            executionTime,
          })
          if (fileExportResponse) return fileExportResponse
        }

        return NextResponse.json({
          success: true,
          output: { result: e2bResult ?? null, stdout: cleanStdout(stdout), executionTime },
        })
      }

      let prologueLineCount = 0
      prologue += 'import json\n'
      prologueLineCount++
      prologue += `params = json.loads(${JSON.stringify(JSON.stringify(executionParams))})\n`
      prologueLineCount++
      prologue += `environmentVariables = json.loads(${JSON.stringify(JSON.stringify(envVars))})\n`
      prologueLineCount++
      for (const [k, v] of Object.entries(contextVariables)) {
        prologue += `${k} = ${formatLiteralForCode(v, 'python')}\n`
        prologueLineCount++
      }
      const wrapped = [
        'def __sim_main__():',
        ...resolvedCode.split('\n').map((l) => `    ${l}`),
        '__sim_result__ = __sim_main__()',
        "print('__SIM_RESULT__=' + json.dumps(__sim_result__))",
      ].join('\n')
      const codeForE2B = prologue + wrapped

      const execStart = Date.now()
      const {
        result: e2bResult,
        stdout: e2bStdout,
        sandboxId,
        error: e2bError,
        exportedFileContent,
      } = await executeInE2B({
        code: codeForE2B,
        language: CodeLanguage.Python,
        timeoutMs: timeout,
        sandboxFiles: _sandboxFiles,
        outputSandboxPath,
      })
      const executionTime = Date.now() - execStart
      stdout += e2bStdout

      logger.info(`[${requestId}] E2B Py sandbox`, {
        sandboxId,
        stdoutPreview: e2bStdout?.slice(0, 200),
        error: e2bError,
      })

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

      if (outputSandboxPath) {
        const fileExportResponse = await maybeExportSandboxFileToWorkspace({
          authUserId: auth.userId,
          workflowId,
          workspaceId,
          outputPath,
          outputFormat,
          outputMimeType,
          outputSandboxPath,
          exportedFileContent,
          stdout,
          executionTime,
        })
        if (fileExportResponse) return fileExportResponse
      }

      return NextResponse.json({
        success: true,
        output: { result: e2bResult ?? null, stdout: cleanStdout(stdout), executionTime },
      })
    }

    const executionMethod = 'isolated-vm'

    const wrapperLines = ['(async () => {', '  try {']
    if (isCustomTool) {
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
      ownerKey: `user:${auth.userId}`,
      ownerWeight: 1,
    })

    const executionTime = Date.now() - startTime

    if (isolatedResult.error) {
      const isSystemError = isolatedResult.error.isSystemError === true
      const logFn = isSystemError ? logger.error.bind(logger) : logger.warn.bind(logger)
      logFn(`[${requestId}] Function execution failed in isolated-vm`, {
        error: isolatedResult.error,
        executionTime,
        isSystemError,
      })

      const ivmError = isolatedResult.error
      let adjustedLine = ivmError.line
      let adjustedLineContent = ivmError.lineContent
      if (prependedLineCount > 0 && ivmError.line !== undefined) {
        adjustedLine = Math.max(1, ivmError.line - prependedLineCount)
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

      const detailLogFn = isSystemError ? logger.error.bind(logger) : logger.warn.bind(logger)
      detailLogFn(`[${requestId}] Enhanced error details`, {
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
        { status: isSystemError ? 500 : 422 }
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
})
