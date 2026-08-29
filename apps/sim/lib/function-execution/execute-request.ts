import type { DelegatedPrincipal, Principal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { getErrorMessage } from '@sim/utils/errors'
import { toRecord } from '@sim/utils/object'
import { NextResponse } from 'next/server'
import type { ParsedFunctionExecuteBody } from '@/lib/api/contracts'
import {
  FORMAT_TO_CONTENT_TYPE,
  getOutputFileDeclarations,
  normalizeOutputWorkspaceFileName,
  type OutputFileDeclaration,
  resolveOutputFormat,
} from '@/lib/copilot/request/tools/files'
import {
  validateWorkspaceFileWriteTarget,
  writeWorkspaceFileByPath,
} from '@/lib/copilot/vfs/resource-writer'
import { isMothershipSandboxEnabled, isRemoteSandboxEnabled } from '@/lib/core/config/env-flags'
import {
  createTimeoutAbortController,
  isTimeoutAbortReason,
  type TimeoutAbortController,
} from '@/lib/core/execution-limits'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { encryptSecret } from '@/lib/core/security/encryption'
import { setRecordValue } from '@/lib/core/utils/records'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  CodePlaceholderCompileError,
  type CodePlaceholderPrivateInput,
  type CodePlaceholderRuntimeBinding,
  compileCodePlaceholders,
} from '@/lib/execution/code-placeholders'
import { parseExecutionDeadlineHeader } from '@/lib/execution/execution-deadline-header'
import { executeInIsolatedVM, type IsolatedVMBrokerHandler } from '@/lib/execution/isolated-vm'
import { CodeLanguage, DEFAULT_CODE_LANGUAGE, isValidCodeLanguage } from '@/lib/execution/languages'
import {
  inspectPrivateSecretProvenanceRequest,
  isPrivateSecretProvenanceBundleV1,
} from '@/lib/execution/model-input-provenance'
import {
  createMountedFileSecretProvenanceScanner,
  type MountedFileSecretProvenanceScanner,
} from '@/lib/execution/mounted-file-secret-provenance'
import { isSandboxLaunchIndeterminateError } from '@/lib/execution/non-retryable-error'
import { recordMaterializedAccessKeys } from '@/lib/execution/payloads/access-keys'
import {
  isLargeArrayManifest,
  materializeLargeArrayManifest,
} from '@/lib/execution/payloads/large-array-manifest'
import { containsLargeValueRef, isLargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import {
  MAX_FUNCTION_INLINE_BYTES,
  MAX_INLINE_MATERIALIZATION_BYTES,
} from '@/lib/execution/payloads/limits'
import {
  readUserFileContent,
  unavailableLargeValueError,
} from '@/lib/execution/payloads/materialization.server'
import {
  collectSandboxFileMountRefs,
  replaceSandboxFileMountRefs,
} from '@/lib/execution/payloads/sandbox-file-mount-ref'
import { compactExecutionPayload } from '@/lib/execution/payloads/serializer'
import { materializeLargeValueRef } from '@/lib/execution/payloads/store'
import {
  MOUNTED_WORKSPACE_FILES_PROVENANCE_KEY,
  PRIVATE_TOOL_METADATA_RESPONSE_HEADER,
  RESOLVED_SECRET_NAMES_DURABLE_FILES_METADATA_V2,
  RESOLVED_SECRET_NAMES_FIELD,
  RESOLVED_SECRET_NAMES_METADATA_V1,
  requestsPrivateToolMetadata,
} from '@/lib/execution/private-tool-metadata'
import {
  executeInSandbox,
  executeShellInSandbox,
  SIM_RESULT_PREFIX,
} from '@/lib/execution/remote-sandbox'
import {
  isSandboxOutputFileError,
  isSandboxOutputLimitError,
  isSandboxOutputNotExportableError,
  MAX_SANDBOX_OUTPUT_BYTES,
} from '@/lib/execution/remote-sandbox/output-limits'
import {
  MAX_BLOCK_MOUNTED_FILES,
  SANDBOX_OUTPUT_DIR,
} from '@/lib/execution/remote-sandbox/sandbox-paths'
import type { SandboxCollectedFile, SandboxFile } from '@/lib/execution/remote-sandbox/types'
import { isExecutionResourceLimitError } from '@/lib/execution/resource-errors'
import { planUserFileMounts, resolveUserFileMounts } from '@/lib/function-execution/sandbox-mounts'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution/execution-file-manager'
import {
  EXACT_EMPTY_WORKSPACE_FILE_SECRET_PROVENANCE,
  mergeWorkspaceFileSecretProvenance,
  type WorkspaceFileSecretProvenance,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { deleteFiles } from '@/lib/uploads/core/storage-service'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'
import { getWorkflowById } from '@/lib/workflows/utils'
import { rebindWorkspaceFileDelegatedPrincipal } from '@/lib/workspace-files/application/delegated-principal'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { readWorkspaceFileContent } from '@/lib/workspace-files/application/read-workspace-file-content'
import { resolveWorkspaceFileReference } from '@/lib/workspace-files/application/resolve-workspace-file-reference'
import { escapeRegExp, normalizeName, REFERENCE, sanitizeFileName } from '@/executor/constants'
import type { UserFile } from '@/executor/types'
import { type OutputSchema, resolveBlockReference } from '@/executor/utils/block-reference'
import {
  createReferencePattern,
  createWorkflowVariablePattern,
} from '@/executor/utils/reference-validation'
import {
  createResolvedSecretMatcher,
  type ResolvedSecretMatcher,
  scanResolvedSecretString,
} from '@/executor/utils/resolved-secret-content-projection'
import { isNonIdentifyingSecretLiteral } from '@/executor/utils/resolved-secret-match-policy'
import type { ResolvedSecretTraceProvenanceV1 } from '@/executor/utils/resolved-secret-trace-registry'

const logger = createLogger('FunctionExecuteAPI')

const TAG_PATTERN = createReferencePattern()

const E2B_JS_WRAPPER_LINES = 3
const E2B_PYTHON_WRAPPER_LINES = 1
const MAX_SANDBOX_OUTPUT_FILES = 20
const MAX_PRIVATE_FILE_SECRET_MATCH_EVENTS = 1_000_000
const SANDBOX_RUNTIME_PAYLOAD_PATH_ENV = '__SIM_RUNTIME_PAYLOAD_PATH'

interface SandboxRuntimePayload {
  params: Record<string, unknown>
  environmentVariables: Record<string, string>
  contextVariables: SandboxRuntimeContextVariable[]
}

type SandboxRuntimeContextVariable =
  | { name: string; kind: 'json'; value: unknown }
  | { name: string; kind: 'undefined' }
  | { name: string; kind: 'non-finite-number'; value: 'nan' | 'positive' | 'negative' }

function encodeSandboxRuntimeContextVariables(
  contextVariables: Record<string, unknown>
): SandboxRuntimeContextVariable[] {
  return Object.entries(contextVariables).map(([name, value]) => {
    if (value === undefined) return { name, kind: 'undefined' }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      return {
        name,
        kind: 'non-finite-number',
        value: Number.isNaN(value) ? 'nan' : value > 0 ? 'positive' : 'negative',
      }
    }
    return { name, kind: 'json', value }
  })
}

function createRuntimeIdentifier(
  code: string,
  reservedNames: Set<string>,
  label: string,
  options: { occupiedIdentifiers?: ReadonlySet<string>; suffix?: string } = {}
): string {
  for (let index = 0; ; index += 1) {
    const candidate = `__sim_runtime_${label}_${index}${options.suffix ?? ''}`
    if (
      !code.includes(candidate) &&
      !reservedNames.has(candidate) &&
      !options.occupiedIdentifiers?.has(candidate)
    ) {
      reservedNames.add(candidate)
      return candidate
    }
  }
}

function createSandboxRuntimePrivateInput(
  payload: SandboxRuntimePayload
): CodePlaceholderPrivateInput {
  return {
    environmentVariable: SANDBOX_RUNTIME_PAYLOAD_PATH_ENV,
    content: JSON.stringify(payload),
  }
}

function buildJavaScriptSandboxRuntime(
  code: string,
  contextVariableNames: string[],
  runtimeBindings: CodePlaceholderRuntimeBinding[],
  occupiedIdentifiers: ReadonlySet<string>
): { importSource: string; prologue: string; internalIdentifiers: string[]; lineCount: number } {
  const reservedNames = new Set([
    ...contextVariableNames,
    ...runtimeBindings.map((binding) => binding.name),
  ])
  const identifierOptions = { occupiedIdentifiers }
  const readFile = createRuntimeIdentifier(code, reservedNames, 'read', identifierOptions)
  const unlink = createRuntimeIdentifier(code, reservedNames, 'unlink', identifierOptions)
  const payloadPath = createRuntimeIdentifier(code, reservedNames, 'path', identifierOptions)
  const payload = createRuntimeIdentifier(code, reservedNames, 'payload', identifierOptions)
  const entry = createRuntimeIdentifier(code, reservedNames, 'entry', identifierOptions)
  const value = createRuntimeIdentifier(code, reservedNames, 'value', identifierOptions)
  const importSource = `import { readFileSync as ${readFile}, unlinkSync as ${unlink} } from 'node:fs';\n`
  const lines = [
    `const ${payloadPath} = process.env[${JSON.stringify(SANDBOX_RUNTIME_PAYLOAD_PATH_ENV)}];`,
    `if (!${payloadPath}) throw new Error('Function runtime payload is unavailable');`,
    `const ${payload} = JSON.parse(${readFile}(${payloadPath}, 'utf8'));`,
    `${unlink}(${payloadPath});`,
    `delete process.env[${JSON.stringify(SANDBOX_RUNTIME_PAYLOAD_PATH_ENV)}];`,
    `const params = ${payload}.params;`,
    `const environmentVariables = ${payload}.environmentVariables;`,
    `for (const ${entry} of ${payload}.contextVariables) {`,
    `  let ${value};`,
    `  if (${entry}.kind === 'json') ${value} = ${entry}.value;`,
    `  else if (${entry}.kind === 'undefined') ${value} = undefined;`,
    `  else if (${entry}.kind === 'non-finite-number') ${value} = ${entry}.value === 'nan' ? NaN : ${entry}.value === 'positive' ? Infinity : -Infinity;`,
    `  else throw new Error('Function runtime context value is invalid');`,
    `  globalThis[${entry}.name] = ${value};`,
    '}',
  ]
  for (const name of contextVariableNames) {
    if (SAFE_IDENTIFIER.test(name) && !JS_RESERVED_WORDS.has(name)) {
      lines.push(`const ${name} = globalThis[${JSON.stringify(name)}];`)
    }
  }
  return {
    importSource,
    prologue: `${lines.join('\n')}\n`,
    internalIdentifiers: [readFile, unlink, payloadPath, payload, entry, value],
    lineCount: lines.length + 1,
  }
}

function buildPythonSandboxRuntime(
  code: string,
  contextVariableNames: string[]
): { prologue: string; internalIdentifiers: string[]; lineCount: number } {
  const reservedNames = new Set(contextVariableNames)
  const identifierOptions = { suffix: '__' }
  const payloadPath = createRuntimeIdentifier(code, reservedNames, 'path', identifierOptions)
  const payloadFile = createRuntimeIdentifier(code, reservedNames, 'file', identifierOptions)
  const payload = createRuntimeIdentifier(code, reservedNames, 'payload', identifierOptions)
  const entry = createRuntimeIdentifier(code, reservedNames, 'entry', identifierOptions)
  const value = createRuntimeIdentifier(code, reservedNames, 'value', identifierOptions)
  const lines = [
    'import json',
    'import os',
    `${payloadPath} = os.environ.pop(${JSON.stringify(SANDBOX_RUNTIME_PAYLOAD_PATH_ENV)}, None)`,
    `if ${payloadPath} is None: raise RuntimeError('Function runtime payload is unavailable')`,
    `with open(${payloadPath}, 'r', encoding='utf-8') as ${payloadFile}:`,
    `    ${payload} = json.load(${payloadFile})`,
    `os.unlink(${payloadPath})`,
    `params = ${payload}['params']`,
    `environmentVariables = ${payload}['environmentVariables']`,
    `for ${entry} in ${payload}['contextVariables']:`,
    `    if ${entry}['kind'] == 'json': ${value} = ${entry}['value']`,
    `    elif ${entry}['kind'] == 'undefined': ${value} = None`,
    `    elif ${entry}['kind'] == 'non-finite-number': ${value} = float('nan') if ${entry}['value'] == 'nan' else (float('inf') if ${entry}['value'] == 'positive' else float('-inf'))`,
    `    else: raise RuntimeError('Function runtime context value is invalid')`,
    `    globals()[${entry}['name']] = ${value}`,
  ]
  return {
    prologue: `${lines.join('\n')}\n`,
    internalIdentifiers: [payloadPath, payloadFile, payload, entry, value],
    lineCount: lines.length,
  }
}

/**
 * Runs syntactically valid Python modules as modules while retaining the legacy
 * Function-body contract for snippets whose top-level `return` only compiles
 * after being wrapped in a function.
 */
function buildPythonSandboxWrapper(source: string): string {
  return [
    `__sim_source__ = ${JSON.stringify(source)}`,
    '__sim_exec_globals__ = dict(globals())',
    '__sim_exec_globals__["__name__"] = "__main__"',
    'try:',
    '    __sim_compiled__ = compile(__sim_source__, "<sim-function-module>", "exec")',
    'except SyntaxError as __sim_compile_error__:',
    '    if "return" not in str(__sim_compile_error__) or "outside function" not in str(__sim_compile_error__):',
    '        raise',
    '    __sim_wrapped_source__ = "def __sim_main__():\\n" + "\\n".join("    " + line for line in __sim_source__.split("\\n"))',
    '    exec(compile(__sim_wrapped_source__, "<sim-function-body>", "exec"), __sim_exec_globals__, __sim_exec_globals__)',
    '    __sim_result__ = __sim_exec_globals__["__sim_main__"]()',
    'else:',
    '    exec(__sim_compiled__, __sim_exec_globals__, __sim_exec_globals__)',
    '    __sim_result__ = __sim_exec_globals__.get("__sim_result__", None)',
    `print('\\n${SIM_RESULT_PREFIX}' + json.dumps(__sim_result__))`,
  ].join('\n')
}

/** Matches valid JS identifier names (letters, digits, underscore; no leading digit). */
const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/** ES2023 reserved words — using these as `const` variable names produces a SyntaxError. */
const JS_RESERVED_WORDS = new Set([
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'let',
  'new',
  'null',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
  'enum',
  'await',
  'implements',
  'interface',
  'package',
  'private',
  'protected',
  'public',
])

type TypeScriptModule = typeof import('@typescript/typescript6')

let typescriptModulePromise: Promise<TypeScriptModule> | null = null

async function loadTypeScriptModule(): Promise<TypeScriptModule> {
  if (!typescriptModulePromise) {
    typescriptModulePromise = import('@typescript/typescript6').then(
      (mod) => (mod?.default ?? mod) as TypeScriptModule,
      (error) => {
        typescriptModulePromise = null
        throw error
      }
    )
  }

  return typescriptModulePromise
}

async function extractJavaScriptImports(code: string): Promise<{
  imports: string
  remainingCode: string
  hasRequireCalls: boolean
  identifierNames: ReadonlySet<string>
}> {
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
    const identifierNames = new Set<string>()
    let hasRequireCalls = false

    const visit = (node: import('@typescript/typescript6').Node): void => {
      if (tsModule.isIdentifier(node)) identifierNames.add(node.text)
      if (
        tsModule.isCallExpression(node) &&
        tsModule.isIdentifier(node.expression) &&
        node.expression.text === 'require'
      ) {
        hasRequireCalls = true
      }
      tsModule.forEachChild(node, visit)
    }
    visit(sourceFile)

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
      return { imports: '', remainingCode: code, hasRequireCalls, identifierNames }
    }

    importSegments.sort((a, b) => a.start - b.start)

    const imports = importSegments.map((segment) => segment.text).join('\n')

    let cursor = 0
    const parts: string[] = []
    for (const segment of importSegments) {
      if (segment.start > cursor) {
        parts.push(code.slice(cursor, segment.start))
      }

      const removedSegment = code.slice(segment.start, segment.end)
      const newlinePlaceholder = removedSegment.replace(/[^\n]/g, '')
      parts.push(newlinePlaceholder)

      cursor = segment.end
    }

    if (cursor < code.length) {
      parts.push(code.slice(cursor))
    }

    const remainingCode = parts.join('')

    return { imports, remainingCode, hasRequireCalls, identifierNames }
  } catch {
    logger.error('Failed to extract JavaScript imports')
    return {
      imports: '',
      remainingCode: code,
      hasRequireCalls: false,
      identifierNames: new Set(),
    }
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
    const moduleMatch = errorOutput.match(/<sim-function-module>[^\n]*line (\d+)/)
    const bodyMatch = errorOutput.match(/<sim-function-body>[^\n]*line (\d+)/)
    const cellMatch = errorOutput.match(/Cell In\[\d+\], line (\d+)/)
    if (moduleMatch) {
      userLine = Number.parseInt(moduleMatch[1], 10)
    } else if (bodyMatch) {
      userLine = Number.parseInt(bodyMatch[1], 10) - 1
    } else if (cellMatch) {
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
function createUserFriendlyErrorMessage(enhanced: EnhancedError, userCode?: string): string {
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

function getErrorDisplayCode(sourceCode: string | undefined, resolvedCode: string): string {
  return sourceCode && sourceCode.length > 0 ? sourceCode : resolvedCode
}

function getLineContent(code: string, line: number | undefined): string | undefined {
  if (line === undefined || line < 1) {
    return undefined
  }

  return code.split('\n')[line - 1]?.trim()
}

function getErrorDisplayMessage(
  message: string,
  sourceCode: string | undefined,
  resolvedCode: string
): string {
  if (!sourceCode || sourceCode === resolvedCode || !resolvedCode.includes('__blockRef_')) {
    return message
  }

  return message.replace(/\s+["']globalThis["']/g, '')
}

function scrubInternalIdentifiers(message: string, identifiers: readonly string[]): string {
  let scrubbed = message
  for (const identifier of identifiers) {
    if (identifier) scrubbed = scrubbed.split(identifier).join('[runtime binding]')
  }
  return scrubbed
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

/**
 * Narrows the secrets an execution can see, per the block's stored scope.
 *
 * | Stored value                | Behavior                                        |
 * |-----------------------------|-------------------------------------------------|
 * | unset (every block today)   | all secrets — the regression-safe default       |
 * | `'all'`                     | all secrets, resolved now so later additions land |
 * | `'selected'` + names        | only those                                      |
 * | `'selected'` + empty list   | none — an explicit deny                         |
 *
 * Unset and `'all'` must both inject everything: agent-authored code already
 * reads `{{MY_SECRET}}` and `environmentVariables['MY_SECRET']` today, so a
 * default-deny would silently break prompts that work right now.
 */
function scopeEnvironmentVariables(
  envVars: Record<string, string>,
  scope: 'all' | 'selected' | undefined,
  mountedSecrets: string[] | undefined
): Record<string, string> {
  if (scope !== 'selected') return envVars

  const allowed = new Set(mountedSecrets ?? [])
  const scoped: Record<string, string> = {}
  const missing: string[] = []
  for (const name of allowed) {
    if (Object.hasOwn(envVars, name)) setRecordValue(scoped, name, envVars[name])
    else missing.push(name)
  }
  if (missing.length > 0) {
    // A secret that was renamed or deleted since the block was configured. Drop
    // it rather than failing: the code's own error is clearer than ours.
    logger.warn('Mounted secrets no longer exist in this workspace', { missing })
  }
  return scoped
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
 * Resolves non-environment references before the shared placeholder compiler runs.
 * @param code - Code with variables
 * @returns Resolved code
 */
function resolveCodeVariables(
  code: string,
  blockData: Record<string, unknown> = {},
  blockNameMapping: Record<string, string> = {},
  blockOutputSchemas: Record<string, OutputSchema> = {},
  workflowVariables: Record<string, unknown> = {},
  language = 'javascript'
): { resolvedCode: string; contextVariables: Record<string, unknown> } {
  let resolvedCode = code
  const contextVariables: Record<string, unknown> = {}

  resolvedCode = resolveWorkflowVariables(resolvedCode, workflowVariables, contextVariables)
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
/**
 * Heuristic: did the sandbox die from an infrastructure failure (OOM kill,
 * timeout, lost connection) rather than a normal code error? Python/JS code
 * exceptions surface via execution.error; an OOM kill instead makes runCode
 * throw, often with an empty or cryptic message.
 */
function isLikelySandboxKill(error: any): boolean {
  const msg = `${error?.name ?? ''} ${error?.message ?? ''} ${error?.code ?? ''}`
    .toLowerCase()
    .trim()
  if (!msg) return true
  return [
    'out of memory',
    'oom',
    'killed',
    'sigkill',
    'code 137',
    'signal 9',
    'terminated',
    'econnreset',
    'epipe',
    'socket hang up',
    'connection closed',
    'connection reset',
    'websocket',
    'timed out',
    'timeout',
    'deadline',
  ].some((s) => msg.includes(s))
}

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

interface FunctionRouteExecutionContext {
  principal: DelegatedPrincipal
  workflowId?: string
  workspaceId?: string
  executionId?: string
  largeValueExecutionIds?: string[]
  largeValueKeys?: string[]
  fileKeys?: string[]
  allowLargeValueWorkflowScope?: boolean
  attributedUserId: string
  fileAccessUserId?: string
  requestId: string
  resolvedSecretNames: Set<string>
  includePrivateResolvedSecretNames: boolean
  privateResolvedSecretNamesMetadataType?: ResolvedSecretNamesMetadataType
  outputSecretMatcher?: ResolvedSecretMatcher
  outputSecretNamesByScanLiteral: Map<string, string[]>
  outputSecretPlaintextsByName: Map<string, string>
  /**
   * In-scope names the caller's registry certified as redaction-exempt. They stay in
   * `outputSecretPlaintextsByName` — the response's resolved-name reporting and the usage
   * trail must not lose them — but contribute no scan literals, so exported files carrying
   * only their values classify exact-empty instead of locking.
   */
  unredactedSecretNames: Set<string>
  mountedFileSecretProvenanceScanner?: MountedFileSecretProvenanceScanner
}

type ResolvedSecretNamesMetadataType =
  | typeof RESOLVED_SECRET_NAMES_METADATA_V1
  | typeof RESOLVED_SECRET_NAMES_DURABLE_FILES_METADATA_V2

function getRequestedResolvedSecretNamesMetadataType(
  headers: Headers
): ResolvedSecretNamesMetadataType | undefined {
  if (requestsPrivateToolMetadata(headers, RESOLVED_SECRET_NAMES_DURABLE_FILES_METADATA_V2)) {
    return RESOLVED_SECRET_NAMES_DURABLE_FILES_METADATA_V2
  }
  return requestsPrivateToolMetadata(headers, RESOLVED_SECRET_NAMES_METADATA_V1)
    ? RESOLVED_SECRET_NAMES_METADATA_V1
    : undefined
}

type MountedWorkspaceFileProvenanceInspection =
  | { status: 'none' }
  | { status: 'verified'; provenance: ResolvedSecretTraceProvenanceV1 }
  | { status: 'invalid' }

function inspectMountedWorkspaceFileProvenance(
  headers: Headers,
  body: unknown
): MountedWorkspaceFileProvenanceInspection {
  const inspection = inspectPrivateSecretProvenanceRequest(headers, body)
  if (inspection.status === 'unsupported') return { status: 'none' }
  if (inspection.status !== 'verified' || !isPrivateSecretProvenanceBundleV1(inspection.value)) {
    return { status: 'invalid' }
  }
  if (!inspection.value.complete) {
    return {
      status: 'verified',
      provenance: { version: 1, complete: false, entries: [] },
    }
  }
  if (
    inspection.value.selections.length !== 1 ||
    inspection.value.selections[0]?.key !== MOUNTED_WORKSPACE_FILES_PROVENANCE_KEY
  ) {
    return { status: 'invalid' }
  }
  return {
    status: 'verified',
    provenance: inspection.value.selections[0].provenance,
  }
}

function getPositiveNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined
  }
  return value
}

function clampInlineBytes(value: unknown, limit = MAX_FUNCTION_INLINE_BYTES): number {
  const requested = getPositiveNumber(value)
  return Math.min(requested ?? limit, limit)
}

function getBrokerFileArgs(args: unknown): {
  file: unknown
  maxBytes: number
  offset?: number
  length?: number
} {
  const record = toRecord(args)
  const options = toRecord(record.options)
  return {
    file: record.file,
    maxBytes: clampInlineBytes(options.maxBytes),
    offset: getPositiveNumber(options.offset),
    length: getPositiveNumber(options.length),
  }
}

function createFunctionRuntimeBrokers(
  context: FunctionRouteExecutionContext
): Record<string, IsolatedVMBrokerHandler> {
  context.largeValueKeys ??= []
  context.fileKeys ??= []
  const largeValueKeys = context.largeValueKeys
  const fileKeys = context.fileKeys
  const base = {
    principal: context.principal,
    requestId: context.requestId,
    workflowId: context.workflowId,
    workspaceId: context.workspaceId,
    executionId: context.executionId,
    largeValueExecutionIds: context.largeValueExecutionIds,
    largeValueKeys,
    fileKeys,
    allowLargeValueWorkflowScope: context.allowLargeValueWorkflowScope,
    userId: context.fileAccessUserId,
    logger,
  }

  const recordMaterializedKeys = (value: unknown) =>
    recordMaterializedAccessKeys({ largeValueKeys, fileKeys }, value)

  const readFile = async (args: unknown, encoding: 'base64' | 'text', chunked = false) => {
    const fileArgs = getBrokerFileArgs(args)
    return readUserFileContent(fileArgs.file, {
      ...base,
      encoding,
      maxBytes: fileArgs.maxBytes,
      chunked,
      offset: chunked ? fileArgs.offset : undefined,
      length: chunked ? fileArgs.length : undefined,
    })
  }

  return {
    'sim.files.readBase64': (args) => readFile(args, 'base64'),
    'sim.files.readText': (args) => readFile(args, 'text'),
    'sim.files.readBase64Chunk': (args) => readFile(args, 'base64', true),
    'sim.files.readTextChunk': (args) => readFile(args, 'text', true),
    'sim.values.read': async (args) => {
      const record = toRecord(args)
      const options = toRecord(record.options)
      const ref = record.ref
      if (!isLargeValueRef(ref)) {
        throw new Error('Expected a large execution value reference.')
      }
      if (!context.executionId) {
        throw new Error('Large execution values require an execution context.')
      }
      const value = await materializeLargeValueRef(ref, {
        ...base,
        maxBytes: clampInlineBytes(options.maxBytes, MAX_INLINE_MATERIALIZATION_BYTES),
      })
      if (value === undefined) {
        throw unavailableLargeValueError(ref)
      }
      recordMaterializedKeys(value)
      return value
    },
    'sim.values.readArray': async (args) => {
      const record = toRecord(args)
      const options = toRecord(record.options)
      const manifest = record.ref
      if (!isLargeArrayManifest(manifest)) {
        throw new Error('Expected a large array manifest.')
      }
      if (!context.executionId) {
        throw new Error('Large array manifests require an execution context.')
      }
      const value = await materializeLargeArrayManifest(manifest, {
        ...base,
        maxBytes: clampInlineBytes(options.maxBytes, MAX_INLINE_MATERIALIZATION_BYTES),
      })
      recordMaterializedKeys(value)
      return value
    },
  }
}

async function compactFunctionRouteBody<T>(
  body: T,
  context: FunctionRouteExecutionContext
): Promise<T> {
  return compactExecutionPayload(body, {
    workflowId: context.workflowId,
    workspaceId: context.workspaceId,
    executionId: context.executionId,
    userId: context.attributedUserId,
    preserveRoot: true,
    requireDurable: Boolean(context.workspaceId && context.workflowId && context.executionId),
  })
}

async function functionJsonResponse<T>(
  body: T,
  context: FunctionRouteExecutionContext,
  init?: ResponseInit
) {
  const responseBody = {
    ...body,
    largeValueKeys: context.largeValueKeys,
    fileKeys: context.fileKeys,
  }
  if (context.includePrivateResolvedSecretNames) {
    activateReferencedSecretProvenance(context)
  }
  const response = NextResponse.json(await compactFunctionRouteBody(responseBody, context), init)
  return appendPrivateResolvedSecretNames(
    response,
    context.includePrivateResolvedSecretNames ? getPrivateResolvedSecretNames(context) : null,
    context.privateResolvedSecretNamesMetadataType
  )
}

/**
 * Activates every secret this invocation's code referenced — compiled `{{KEY}}` bindings and
 * recognized direct reads, filtered to configured environment values.
 *
 * Deliberately not gated on the value appearing in the output. Gating it was backwards for
 * both consumers of these names: a run that used a key silently — an ordinary API call, or a
 * value exfiltrated in transformed form — reported nothing, so the usage trail missed exactly
 * the runs it exists to catch, while downstream masking never learned a value the code
 * demonstrably held. The referenced set errs toward reporting instead: an extra name only
 * hands the matcher a value that never appears. Configured-but-unreferenced values are never
 * included, and the functional result is never mutated.
 */
function activateReferencedSecretProvenance(context: FunctionRouteExecutionContext): void {
  for (const name of context.outputSecretPlaintextsByName.keys()) {
    context.resolvedSecretNames.add(name)
  }
}

/**
 * Compiled secret names that still demand redaction, and whose value a scan could
 * actually find. Exempt names don't count.
 *
 * Non-identifying literals are excluded on the same predicate
 * {@link createResolvedSecretMatcher} uses to drop them, because the two decisions
 * have to agree. When every in-scope value is shorter than the substitutable-literal
 * minimum, the matcher builds nothing and returns `undefined`; a counter that still
 * reported those names would send
 * {@link getOutputFileSecretProvenance} down its no-matcher branch and classify
 * every output as `unknown` — failing an export while claiming it contains a
 * secret that, by that very policy, is too short to be attributed to anything.
 */
function countProtectedOutputSecretNames(context: FunctionRouteExecutionContext): number {
  let count = 0
  for (const [name, plaintext] of context.outputSecretPlaintextsByName) {
    if (context.unredactedSecretNames.has(name)) continue
    if (isNonIdentifyingSecretLiteral(plaintext)) continue
    count += 1
  }
  return count
}

/**
 * True when this execution compiled a secret placeholder or received a mounted file with verified
 * secret provenance. Ordinary mounts without a provenance envelope are user data, not evidence that
 * a Sim secret was resolved in this call. Exempt names don't count: a binary export whose only
 * in-scope secrets are redaction-exempt is deliberately classified exact-empty rather than locked.
 */
function hasSecretMaterialInScope(context: FunctionRouteExecutionContext): boolean {
  if (countProtectedOutputSecretNames(context) > 0) return true
  return context.mountedFileSecretProvenanceScanner?.hasSecrets ?? false
}

/**
 * Classifies the secret provenance of one exported sandbox file.
 *
 * Text exports are scanned for the exact resolved-secret plaintexts in scope. Binary exports cannot
 * be scanned soundly — re-encoding can carry a secret without leaving a literal substring — so they
 * are classified only when no secret material was in scope at all; with nothing available to embed,
 * the bytes are provably secret-free. Otherwise they stay unknown, which fails closed at every
 * model and runtime boundary that later reads the file.
 */
async function getOutputFileSecretProvenance(
  buffer: Buffer,
  isBinary: boolean,
  context: FunctionRouteExecutionContext,
  scope: { userId: string; workspaceId: string }
): Promise<WorkspaceFileSecretProvenance> {
  if (isBinary) {
    return hasSecretMaterialInScope(context)
      ? { status: 'unknown' }
      : EXACT_EMPTY_WORKSPACE_FILE_SECRET_PROVENANCE
  }
  const mountedFileProvenance = context.mountedFileSecretProvenanceScanner?.scan(buffer) ?? {
    status: 'exact' as const,
    entries: [],
  }
  if (countProtectedOutputSecretNames(context) === 0) {
    return mountedFileProvenance
  }
  if (!context.outputSecretMatcher) return { status: 'unknown' }

  const matchedNames = new Set<string>()
  try {
    scanResolvedSecretString(
      buffer.toString('utf8'),
      context.outputSecretMatcher,
      (scanLiteral) => {
        for (const name of context.outputSecretNamesByScanLiteral.get(scanLiteral) ?? []) {
          matchedNames.add(name)
        }
      },
      MAX_PRIVATE_FILE_SECRET_MATCH_EVENTS
    )
  } catch {
    return { status: 'unknown' }
  }

  try {
    const entries = await Promise.all(
      [...matchedNames].sort().map(async (name) => {
        const plaintext = context.outputSecretPlaintextsByName.get(name)
        if (plaintext === undefined) {
          throw new Error('Resolved secret provenance name is outside the scoped catalog')
        }
        return {
          name,
          encryptedValue: (await encryptSecret(plaintext)).encrypted,
          sourceUserId: scope.userId,
          sourceWorkspaceId: scope.workspaceId,
        }
      })
    )
    return mergeWorkspaceFileSecretProvenance({ status: 'exact', entries }, mountedFileProvenance)
  } catch {
    return { status: 'unknown' }
  }
}

function getPrivateResolvedSecretNames(context: FunctionRouteExecutionContext): string[] {
  return Array.from(context.resolvedSecretNames).sort()
}

async function appendResolvedSecretNames(
  response: NextResponse,
  context: FunctionRouteExecutionContext
): Promise<NextResponse> {
  if (!context.includePrivateResolvedSecretNames) return response
  activateReferencedSecretProvenance(context)
  return appendPrivateResolvedSecretNames(
    response,
    getPrivateResolvedSecretNames(context),
    context.privateResolvedSecretNamesMetadataType
  )
}

async function appendPrivateResolvedSecretNames(
  response: NextResponse,
  names: string[] | null,
  metadataType?: ResolvedSecretNamesMetadataType
): Promise<NextResponse> {
  if (!names || !metadataType) return response

  const body = (await response.json()) as Record<string, unknown>
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  headers.set(PRIVATE_TOOL_METADATA_RESPONSE_HEADER, metadataType)
  return NextResponse.json(
    {
      ...body,
      [RESOLVED_SECRET_NAMES_FIELD]: names,
    },
    { status: response.status, statusText: response.statusText, headers }
  )
}

export interface FunctionExecutionRequestContext {
  headers: Headers
  signal: AbortSignal
}

export function projectFunctionValidationResponse(
  req: Pick<FunctionExecutionRequestContext, 'headers'>,
  response: NextResponse
): Promise<NextResponse> {
  const metadataType = getRequestedResolvedSecretNamesMetadataType(req.headers)
  return appendPrivateResolvedSecretNames(response, metadataType ? [] : null, metadataType)
}

/**
 * Compares an about-to-be-exported buffer against the overwrite target's
 * current content. `identical: true` means the export is a byte-for-byte no-op:
 * either a legitimately idempotent regeneration, or the incident signature of
 * code that never wrote to the declared sandboxPath (the file still holds the
 * mounted input). Only the model can tell those apart, so callers surface the
 * fact loudly in the receipt instead of failing the write. Comparison is
 * advisory and never blocks the authoritative write; the current content is
 * only downloaded when the sizes already match.
 */
async function checkOverwriteTarget(
  principal: Principal,
  workspaceId: string,
  targetPath: string,
  buffer: Buffer
): Promise<{ previousSize?: number; identical: boolean }> {
  try {
    const existing = await resolveWorkspaceFileReference({
      principal,
      operation: fileOperations.updateContent,
      workspaceId,
      reference: targetPath,
    })
    if (existing.size !== buffer.length) {
      return { previousSize: existing.size, identical: false }
    }
    const { content: current } = await readWorkspaceFileContent.execute({
      principal,
      input: {
        fileId: existing.id,
        assertedWorkspaceId: workspaceId,
        maxBytes: buffer.length,
      },
    })
    return { previousSize: existing.size, identical: current.equals(buffer) }
  } catch (error) {
    logger.warn('Unable to compare workspace overwrite target before export', {
      workspaceId,
      targetPath,
      error: getErrorMessage(error),
    })
    return { identical: false }
  }
}

function formatExportReceipt(bytes: number, previousSize: number | undefined, sha256: string) {
  return `(${bytes} bytes${
    previousSize !== undefined ? `, replaced ${previousSize} bytes` : ''
  }, sha256:${sha256.slice(0, 16)})`
}

function exportUnchangedNote(sandboxPath?: string): string {
  return (
    'WARNING: content is byte-identical to the previous version — nothing changed.' +
    (sandboxPath
      ? ` If you expected new content, your code did not modify the sandbox file at "${sandboxPath}" (it still holds the mounted input); write the new content to exactly that path and export again.`
      : ' If you expected new content, the code returned the same bytes as before.')
  )
}

function exportFailure(
  error: string,
  status: number,
  stdout: string,
  executionTime: number
): NextResponse {
  return NextResponse.json(
    { success: false, error, output: { result: null, stdout: cleanStdout(stdout), executionTime } },
    { status }
  )
}

function workspaceFileExportErrorStatus(error: unknown): number {
  return asOrchestrationError(error)?.code === 'forbidden' ? 403 : 400
}

async function maybeExportSandboxFileToWorkspace(args: {
  routeContext: FunctionRouteExecutionContext
  authUserId: string
  workflowId?: string
  workspaceId?: string
  outputPath?: string
  outputFormat?: string
  outputMimeType?: string
  outputSandboxPath?: string
  overwriteFileId?: string
  outputMode?: 'create' | 'overwrite'
  exportedFileContent?: string
  stdout: string
  executionTime: number
}) {
  const {
    routeContext,
    authUserId,
    workflowId,
    workspaceId,
    outputPath,
    outputFormat,
    outputMimeType,
    outputSandboxPath,
    overwriteFileId,
    outputMode,
    exportedFileContent,
    stdout,
    executionTime,
  } = args

  if (!outputSandboxPath) return null

  if (!outputPath) {
    return exportFailure(
      'outputSandboxPath requires outputPath. Set outputPath to the destination workspace file, e.g. "files/result.csv".',
      400,
      stdout,
      executionTime
    )
  }

  const resolvedWorkspaceId =
    workspaceId || (workflowId ? (await getWorkflowById(workflowId))?.workspaceId : undefined)

  if (!resolvedWorkspaceId) {
    return exportFailure(
      'Workspace context required to save sandbox file to workspace',
      400,
      stdout,
      executionTime
    )
  }

  if (exportedFileContent === undefined) {
    return exportFailure(
      `Sandbox file "${outputSandboxPath}" was not found or could not be read`,
      500,
      stdout,
      executionTime
    )
  }

  const fileName = normalizeOutputWorkspaceFileName(outputPath)

  const TEXT_MIMES = new Set(Object.values(FORMAT_TO_CONTENT_TYPE))
  const resolvedMimeType =
    outputMimeType ||
    FORMAT_TO_CONTENT_TYPE[resolveOutputFormat(fileName, outputFormat)] ||
    'application/octet-stream'
  const isBinary = !TEXT_MIMES.has(resolvedMimeType)
  const outputBytes = Buffer.byteLength(exportedFileContent, isBinary ? 'base64' : 'utf-8')
  if (outputBytes > MAX_SANDBOX_OUTPUT_BYTES) {
    return exportFailure(
      `Sandbox output files exceed ${MAX_SANDBOX_OUTPUT_BYTES} bytes total`,
      400,
      stdout,
      executionTime
    )
  }
  const fileBuffer = isBinary
    ? Buffer.from(exportedFileContent, 'base64')
    : Buffer.from(exportedFileContent, 'utf-8')
  const secretProvenance = await getOutputFileSecretProvenance(fileBuffer, isBinary, routeContext, {
    userId: authUserId,
    workspaceId: resolvedWorkspaceId,
  })

  const mode = outputMode ?? (overwriteFileId ? 'overwrite' : 'create')
  const targetPath = mode === 'create' ? outputPath : overwriteFileId || outputPath
  const principal = rebindWorkspaceFileDelegatedPrincipal({
    principal: routeContext.principal,
    workspaceId: resolvedWorkspaceId,
    delegationId: `function-execute:${routeContext.requestId}`,
    executionId: routeContext.executionId,
  })

  let previousSize: number | undefined
  let unchanged = false
  if (mode === 'overwrite') {
    const check = await checkOverwriteTarget(principal, resolvedWorkspaceId, targetPath, fileBuffer)
    previousSize = check.previousSize
    unchanged = check.identical
  }

  try {
    const sha256 = sha256Hex(fileBuffer)
    const written = await writeWorkspaceFileByPath({
      workspaceId: resolvedWorkspaceId,
      principal,
      target: {
        path: targetPath,
        mode,
        mimeType: outputMimeType,
      },
      buffer: fileBuffer,
      inferredMimeType: resolvedMimeType,
      secretProvenance,
    })
    logger.info('Sandbox file exported to workspace', {
      fileId: written.id,
      vfsPath: written.vfsPath,
      sandboxPath: outputSandboxPath,
      mode,
      mimeType: resolvedMimeType,
      size: fileBuffer.length,
      previousSize,
      sha256,
      unchanged,
    })
    return NextResponse.json({
      success: true,
      output: {
        result: {
          message: `Sandbox file exported to ${written.vfsPath} ${formatExportReceipt(
            fileBuffer.length,
            previousSize,
            sha256
          )}${unchanged ? ` — ${exportUnchangedNote(outputSandboxPath)}` : ''}`,
          fileId: written.id,
          fileName: written.name,
          vfsPath: written.vfsPath,
          downloadUrl: written.downloadUrl,
          sandboxPath: outputSandboxPath,
          size: fileBuffer.length,
          previousSize,
          sha256,
          unchanged,
        },
        stdout: cleanStdout(stdout),
        executionTime,
      },
      resources: [{ type: 'file', id: written.id, title: written.name, path: written.vfsPath }],
    })
  } catch (error) {
    return exportFailure(
      getErrorMessage(error, 'Failed to export sandbox file'),
      workspaceFileExportErrorStatus(error),
      stdout,
      executionTime
    )
  }
}

async function maybeExportSandboxFilesToWorkspace(args: {
  routeContext: FunctionRouteExecutionContext
  authUserId: string
  workflowId?: string
  workspaceId?: string
  outputFiles: OutputFileDeclaration[]
  exportedFiles?: Record<string, string>
  exportedFileContent?: string
  stdout: string
  executionTime: number
}) {
  const sandboxFiles = args.outputFiles.filter((file) => file.sandboxPath)
  if (sandboxFiles.length === 0) return null
  if (sandboxFiles.length > MAX_SANDBOX_OUTPUT_FILES) {
    return exportFailure(
      `Too many sandbox output files requested (${sandboxFiles.length}). Maximum is ${MAX_SANDBOX_OUTPUT_FILES}.`,
      400,
      args.stdout,
      args.executionTime
    )
  }

  if (sandboxFiles.length === 1) {
    const file = sandboxFiles[0]
    return maybeExportSandboxFileToWorkspace({
      routeContext: args.routeContext,
      authUserId: args.authUserId,
      workflowId: args.workflowId,
      workspaceId: args.workspaceId,
      outputPath: file.formatPath ?? file.path,
      outputFormat: file.format,
      outputMimeType: file.mimeType,
      outputSandboxPath: file.sandboxPath,
      outputMode: file.mode,
      exportedFileContent:
        (file.sandboxPath ? args.exportedFiles?.[file.sandboxPath] : undefined) ??
        args.exportedFileContent,
      stdout: args.stdout,
      executionTime: args.executionTime,
    })
  }

  const resolvedWorkspaceId =
    args.workspaceId ||
    (args.workflowId ? (await getWorkflowById(args.workflowId))?.workspaceId : undefined)
  if (!resolvedWorkspaceId) {
    return exportFailure(
      'Workspace context required to save sandbox files to workspace',
      400,
      args.stdout,
      args.executionTime
    )
  }

  const preparedFiles = []
  let totalOutputBytes = 0
  for (const file of sandboxFiles) {
    const sandboxPath = file.sandboxPath!
    const content = args.exportedFiles?.[sandboxPath]
    if (content === undefined) {
      return exportFailure(
        `Sandbox file "${sandboxPath}" was not found or could not be read`,
        500,
        args.stdout,
        args.executionTime
      )
    }
    const outputPath = file.formatPath ?? file.path
    const fileName = normalizeOutputWorkspaceFileName(outputPath)
    const resolvedMimeType =
      file.mimeType ||
      FORMAT_TO_CONTENT_TYPE[resolveOutputFormat(fileName, file.format)] ||
      'application/octet-stream'
    const isBinary = !new Set(Object.values(FORMAT_TO_CONTENT_TYPE)).has(resolvedMimeType)
    const size = Buffer.byteLength(content, isBinary ? 'base64' : 'utf-8')
    totalOutputBytes += size
    if (totalOutputBytes > MAX_SANDBOX_OUTPUT_BYTES) {
      return exportFailure(
        `Sandbox output files exceed ${MAX_SANDBOX_OUTPUT_BYTES} bytes total`,
        400,
        args.stdout,
        args.executionTime
      )
    }
    const scanBuffer = isBinary ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf-8')
    const secretProvenance = await getOutputFileSecretProvenance(
      scanBuffer,
      isBinary,
      args.routeContext,
      { userId: args.authUserId, workspaceId: resolvedWorkspaceId }
    )
    preparedFiles.push({
      file,
      sandboxPath,
      content,
      resolvedMimeType,
      isBinary,
      size,
      secretProvenance,
      target: {
        path: (file.mode ?? 'create') === 'create' ? outputPath : file.path,
        mode: file.mode ?? 'create',
        mimeType: file.mimeType,
      },
    })
  }

  const principal = rebindWorkspaceFileDelegatedPrincipal({
    principal: args.routeContext.principal,
    workspaceId: resolvedWorkspaceId,
    delegationId: `function-execute:${args.routeContext.requestId}`,
    executionId: args.routeContext.executionId,
  })
  let validationPaths: string[]
  try {
    const validations = await Promise.all(
      preparedFiles.map((prepared) =>
        validateWorkspaceFileWriteTarget({
          workspaceId: resolvedWorkspaceId,
          principal,
          target: prepared.target,
        })
      )
    )
    validationPaths = validations.map((validation) => validation.vfsPath)
  } catch (error) {
    return exportFailure(
      getErrorMessage(error, 'Invalid sandbox output destination'),
      workspaceFileExportErrorStatus(error),
      args.stdout,
      args.executionTime
    )
  }
  const duplicateDestination = validationPaths.find(
    (vfsPath, index) => validationPaths.indexOf(vfsPath) !== index
  )
  if (duplicateDestination) {
    return exportFailure(
      `Duplicate sandbox output destination: ${duplicateDestination}`,
      400,
      args.stdout,
      args.executionTime
    )
  }

  const writtenFiles = []
  try {
    for (const prepared of preparedFiles) {
      const buffer = prepared.isBinary
        ? Buffer.from(prepared.content, 'base64')
        : Buffer.from(prepared.content, 'utf-8')
      let previousSize: number | undefined
      let unchanged = false
      if (prepared.target.mode === 'overwrite') {
        const check = await checkOverwriteTarget(
          principal,
          resolvedWorkspaceId,
          prepared.target.path,
          buffer
        )
        previousSize = check.previousSize
        unchanged = check.identical
      }
      const sha256 = sha256Hex(buffer)
      const written = await writeWorkspaceFileByPath({
        workspaceId: resolvedWorkspaceId,
        principal,
        target: prepared.target,
        buffer,
        inferredMimeType: prepared.resolvedMimeType,
        secretProvenance: prepared.secretProvenance,
      })
      logger.info('Sandbox file exported to workspace', {
        fileId: written.id,
        vfsPath: written.vfsPath,
        sandboxPath: prepared.sandboxPath,
        mode: prepared.file.mode ?? 'create',
        mimeType: prepared.resolvedMimeType,
        size: prepared.size,
        previousSize,
        sha256,
        unchanged,
      })
      writtenFiles.push({
        ...written,
        sandboxPath: prepared.sandboxPath,
        exportedBytes: buffer.length,
        previousSize,
        sha256,
        unchanged,
      })
    }
  } catch (error) {
    return exportFailure(
      getErrorMessage(error, 'Failed to export sandbox files'),
      workspaceFileExportErrorStatus(error),
      args.stdout,
      args.executionTime
    )
  }

  const unchangedFiles = writtenFiles.filter((file) => file.unchanged)
  return NextResponse.json({
    success: true,
    output: {
      result: {
        message: `Exported ${writtenFiles.length} sandbox files: ${writtenFiles
          .map(
            (file) =>
              `${file.vfsPath} ${formatExportReceipt(
                file.exportedBytes,
                file.previousSize,
                file.sha256
              )}${file.unchanged ? ' [UNCHANGED]' : ''}`
          )
          .join('; ')}${
          unchangedFiles.length > 0
            ? ` — WARNING: ${unchangedFiles.map((file) => file.vfsPath).join(', ')} ${
                unchangedFiles.length === 1 ? 'is' : 'are'
              } byte-identical to the previous version (nothing changed). If you expected new content there, your code did not modify the corresponding sandbox file.`
            : ''
        }`,
        files: writtenFiles.map((file) => ({
          fileId: file.id,
          fileName: file.name,
          vfsPath: file.vfsPath,
          downloadUrl: file.downloadUrl,
          sandboxPath: file.sandboxPath,
          size: file.exportedBytes,
          previousSize: file.previousSize,
          sha256: file.sha256,
          unchanged: file.unchanged,
        })),
      },
      stdout: cleanStdout(args.stdout),
      executionTime: args.executionTime,
    },
    resources: writtenFiles.map((file) => ({
      type: 'file',
      id: file.id,
      title: file.name,
      path: file.vfsPath,
    })),
  })
}

/**
 * Combines caller-supplied mounts — Copilot resolves its own workspace paths —
 * with those resolved from platform file objects.
 *
 * A duplicate destination is rejected rather than settled by order:
 * `writeSandboxInputs` materializes in sequence, so the later entry would
 * silently overwrite the earlier one and the code would find something other
 * than what it asked for at that path.
 */
function mergeSandboxFileMounts(
  callerFiles: SandboxFile[] | undefined,
  resolvedFiles: SandboxFile[]
): SandboxFile[] | undefined {
  if (!callerFiles?.length) return resolvedFiles.length > 0 ? resolvedFiles : undefined
  if (resolvedFiles.length === 0) return callerFiles

  const merged = [...callerFiles, ...resolvedFiles]
  const seen = new Set<string>()
  for (const file of merged) {
    if (seen.has(file.path)) {
      throw new Error(`Duplicate sandbox mount path: ${file.path}`)
    }
    seen.add(file.path)
  }
  return merged
}

/**
 * A harvested file's name, derived from its path relative to the output
 * directory. Subdirectories are folded into the name rather than dropped, so
 * `reports/q4.csv` and `q4.csv` stay distinguishable — and a `/` never survives
 * into a name that later reaches an email attachment or an upload filename.
 */
function collectedFileName(relativePath: string): string {
  return sanitizeFileName(relativePath.split('/').filter(Boolean).join('-')) || 'file'
}

/**
 * Persists files harvested from the sandbox output directory as platform file
 * objects, so any downstream tool that accepts a file can consume them.
 *
 * Uploaded here, one at a time, rather than handed to the declarative
 * file-output pipeline as bytes: that path would carry the whole export budget
 * as base64 through `JSON.stringify`, a response buffer, and a re-parse, so
 * several multiples of the payload would be live at once for a value that is a
 * couple of hundred bytes per file once stored.
 */
/**
 * Removes files already uploaded when a later one in the same harvest is refused.
 *
 * The route answers with a failure and hands back no references, so anything
 * uploaded before the refusal is unreachable — but it still occupies storage,
 * and the harvest is all-or-nothing by design. Best-effort on purpose: the
 * caller needs to hear why its export was refused, not that the tidy-up failed.
 */
async function discardUploadedExecutionFiles(files: readonly UserFile[]): Promise<void> {
  if (files.length === 0) return
  try {
    await deleteFiles(
      files.map((file) => file.key),
      'execution'
    )
  } catch (error) {
    logger.warn('Could not remove partially uploaded sandbox output files', {
      fileCount: files.length,
      error: getErrorMessage(error),
    })
  }
}

async function collectExecutionOutputFiles(args: {
  routeContext: FunctionRouteExecutionContext
  authUserId: string
  workflowId?: string
  workspaceId?: string
  executionId?: string
  collectedFiles: SandboxCollectedFile[]
  stdout: string
  executionTime: number
}): Promise<{ files: UserFile[] } | { response: NextResponse }> {
  const { routeContext, collectedFiles } = args
  if (collectedFiles.length === 0) return { files: [] }

  const resolvedWorkspaceId =
    args.workspaceId ||
    (args.workflowId ? (await getWorkflowById(args.workflowId))?.workspaceId : undefined)

  // Fails rather than returning an empty list: the code did produce files, and
  // reporting success without them would read as "your script wrote nothing".
  if (!resolvedWorkspaceId || !args.workflowId || !args.executionId) {
    return {
      response: exportFailure(
        'Workspace, workflow, and execution context are required to return files from the sandbox.',
        400,
        args.stdout,
        args.executionTime
      ),
    }
  }

  const files: UserFile[] = []
  for (const collected of args.collectedFiles) {
    const buffer = Buffer.from(collected.contentBase64, 'base64')
    const name = collectedFileName(collected.relativePath)
    const mimeType = getMimeTypeFromExtension(getFileExtension(name))

    // Scanned unconditionally — never gated on whether the bytes look textual.
    // Both a filename check and a UTF-8 round-trip were trivially defeated: name
    // the file `.png`, or append one invalid byte, and a plaintext secret sailed
    // past. A lossy UTF-8 decode preserves ASCII runs, so a literal secret is
    // findable in any buffer, textual or not.
    //
    // What stays out of reach is a secret carried in transformed form — deflated
    // inside a PDF, re-encoded — which no substring scan can see. That is an
    // inherent limit of scanning, not a hole in the gate, and it is why these
    // files are execution-scoped rather than durable workspace files.
    {
      const provenance = await getOutputFileSecretProvenance(buffer, false, routeContext, {
        userId: args.authUserId,
        workspaceId: resolvedWorkspaceId,
      })
      // An execution-scoped file has nowhere to record a provenance envelope, so
      // one carrying a resolved secret cannot ship under a lock the way a
      // workspace file can — it is refused instead.
      if (provenance.status !== 'exact' || provenance.entries.length > 0) {
        await discardUploadedExecutionFiles(files)
        return {
          response: exportFailure(
            `Sandbox output file "${name}" contains a resolved secret value and was not returned. Write the file without embedding secret values, or export it to a workspace file where its provenance can be recorded.`,
            400,
            args.stdout,
            args.executionTime
          ),
        }
      }
    }

    const userFile = await uploadExecutionFile(
      {
        workspaceId: resolvedWorkspaceId,
        workflowId: args.workflowId,
        executionId: args.executionId,
      },
      buffer,
      name,
      mimeType,
      args.authUserId
    )
    files.push(userFile)
  }

  // Registers the new keys on the execution so downstream blocks are authorized
  // to read them back.
  routeContext.fileKeys = [
    ...new Set([...(routeContext.fileKeys ?? []), ...files.map((file) => file.key)]),
  ]

  logger.info('Returned sandbox output files', {
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.size, 0),
  })

  return { files }
}

export interface TrustedFunctionExecutionAuth {
  attributedUserId: string
  fileAccessUserId?: string
  principal: DelegatedPrincipal
  sandboxProfile?: 'mothership'
}

/** Executes the Function protocol after the application operation authorizes its principal. */
export async function executeFunctionRequest(
  req: FunctionExecutionRequestContext,
  body: ParsedFunctionExecuteBody,
  auth: TrustedFunctionExecutionAuth
): Promise<NextResponse> {
  const requestId = generateRequestId()
  const startTime = Date.now()
  let stdout = ''
  let userCodeStartLine = 3 // Default value for error reporting
  let resolvedCode = '' // Store resolved code for error reporting
  let sourceCodeForErrors: string | undefined
  let compilerInternalIdentifiers: string[] = []
  let compilerPrivateInputs: CodePlaceholderPrivateInput[] = []
  let compilerRuntimeBindings: CodePlaceholderRuntimeBinding[] = []
  let routeContext: FunctionRouteExecutionContext | undefined
  let includePrivateResolvedSecretNames = false
  let privateResolvedSecretNamesMetadataType: ResolvedSecretNamesMetadataType | undefined
  let timeoutForError: number | undefined
  let executionDeadlineAt: number | undefined
  let executionDeadlineController: TimeoutAbortController | undefined
  let executionSignal = req.signal

  try {
    const usesMothershipSandbox = auth.sandboxProfile === 'mothership'

    executionDeadlineAt = parseExecutionDeadlineHeader(req.headers)
    privateResolvedSecretNamesMetadataType = getRequestedResolvedSecretNamesMetadataType(
      req.headers
    )
    includePrivateResolvedSecretNames = privateResolvedSecretNamesMetadataType !== undefined

    const mountedWorkspaceFileProvenance = inspectMountedWorkspaceFileProvenance(req.headers, body)
    if (mountedWorkspaceFileProvenance.status === 'invalid') {
      return appendPrivateResolvedSecretNames(
        NextResponse.json(
          { success: false, error: 'Mounted file secret provenance is invalid' },
          { status: 400 }
        ),
        includePrivateResolvedSecretNames ? [] : null,
        privateResolvedSecretNamesMetadataType
      )
    }
    const mountedFileSecretProvenanceScanner =
      mountedWorkspaceFileProvenance.status === 'verified'
        ? await createMountedFileSecretProvenanceScanner(mountedWorkspaceFileProvenance.provenance)
        : undefined
    if (
      mountedWorkspaceFileProvenance.status === 'verified' &&
      !mountedFileSecretProvenanceScanner
    ) {
      return appendPrivateResolvedSecretNames(
        NextResponse.json(
          { success: false, error: 'Mounted file secret provenance is unavailable' },
          { status: 400 }
        ),
        includePrivateResolvedSecretNames ? [] : null,
        privateResolvedSecretNamesMetadataType
      )
    }

    const { DEFAULT_EXECUTION_TIMEOUT_MS } = await import('@/lib/execution/constants')

    const {
      code,
      sourceCode,
      params = {},
      timeout: requestedTimeout,
      language = DEFAULT_CODE_LANGUAGE,
      outputPath,
      outputFormat,
      outputMimeType,
      outputSandboxPath,
      overwriteFileId,
      outputs,
      envVars: rawEnvVars = {},
      secretScope,
      mountedSecrets,
      unredactedSecretNames = [],
      sandboxId: selectedSandboxId,
      blockData = {},
      blockNameMapping = {},
      blockOutputSchemas = {},
      workflowVariables = {},
      contextVariables: preResolvedContextVariables = {},
      workflowId,
      executionId,
      largeValueExecutionIds,
      largeValueKeys,
      fileKeys,
      allowLargeValueWorkflowScope = false,
      workspaceId,
      isCustomTool = false,
      files: mountedUserFiles,
      _sandboxFiles,
    } = body

    if (selectedSandboxId && !isRemoteSandboxEnabled) {
      return NextResponse.json(
        { success: false, error: 'The Function code sandbox is not configured' },
        { status: 503 }
      )
    }
    if (usesMothershipSandbox && !selectedSandboxId && !isMothershipSandboxEnabled) {
      return NextResponse.json(
        { success: false, error: 'Mothership code sandbox is not configured' },
        { status: 503 }
      )
    }
    // A selected Sim sandbox is layered on the Function base, even for a
    // trusted Mothership call. Only an unselected Mothership call uses the
    // separately built Mothership image.
    const remoteSandboxEnabled = selectedSandboxId
      ? isRemoteSandboxEnabled
      : usesMothershipSandbox
        ? isMothershipSandboxEnabled
        : isRemoteSandboxEnabled
    const remainingExecutionMs =
      executionDeadlineAt === undefined ? undefined : Math.max(1, executionDeadlineAt - Date.now())
    const timeout =
      remainingExecutionMs === undefined
        ? (requestedTimeout ?? DEFAULT_EXECUTION_TIMEOUT_MS)
        : Math.max(1, Math.min(requestedTimeout ?? remainingExecutionMs, remainingExecutionMs))
    executionDeadlineController = createTimeoutAbortController(timeout, req.signal)
    executionSignal = executionDeadlineController.signal
    timeoutForError = timeout
    // Scoped before {{VAR}} resolution so the `{{NAME}}` path and the
    // `environmentVariables[...]` dict narrow together — filtering only the dict
    // would leave `{{OTHER_SECRET}}` resolving, which is a hole, not a scope.
    const envVars = scopeEnvironmentVariables(rawEnvVars, secretScope, mountedSecrets)
    sourceCodeForErrors = sourceCode ?? code
    const outputFiles = getOutputFileDeclarations({
      outputs,
      outputPath,
      outputFormat,
      outputMimeType,
      outputSandboxPath,
      overwriteFileId,
    })
    const outputSandboxPaths = outputFiles
      .map((file) => file.sandboxPath)
      .filter((path): path is string => Boolean(path))
    if (outputSandboxPaths.length > MAX_SANDBOX_OUTPUT_FILES) {
      return appendPrivateResolvedSecretNames(
        NextResponse.json(
          {
            success: false,
            error: `Too many sandbox output files requested (${outputSandboxPaths.length}). Maximum is ${MAX_SANDBOX_OUTPUT_FILES}.`,
          },
          { status: 400 }
        ),
        includePrivateResolvedSecretNames ? [] : null,
        privateResolvedSecretNamesMetadataType
      )
    }

    // Planned before the runtime is chosen because it is pure: it decides whether
    // this execution needs a sandbox filesystem at all, without spending a presign
    // or a byte of transfer on a request the guard below may still refuse.

    const executionParams = { ...params }
    executionParams._context = undefined

    logger.info(`[${requestId}] Function execution request`, {
      hasCode: !!code,
      paramsCount: Object.keys(executionParams).length,
      timeout,
      workflowId,
      executionId,
      isCustomTool,
    })

    routeContext = {
      principal: auth.principal,
      workflowId,
      workspaceId,
      executionId,
      largeValueExecutionIds,
      largeValueKeys,
      fileKeys,
      allowLargeValueWorkflowScope,
      attributedUserId: auth.attributedUserId,
      fileAccessUserId: auth.fileAccessUserId,
      requestId,
      resolvedSecretNames: new Set<string>(),
      includePrivateResolvedSecretNames,
      privateResolvedSecretNamesMetadataType,
      outputSecretNamesByScanLiteral: new Map(),
      outputSecretPlaintextsByName: new Map(),
      unredactedSecretNames: new Set(
        unredactedSecretNames.filter((name) => Object.hasOwn(envVars, name))
      ),
      mountedFileSecretProvenanceScanner,
    }

    const lang = isValidCodeLanguage(language) ? language : DEFAULT_CODE_LANGUAGE

    const codeResolution = resolveCodeVariables(
      code,
      blockData,
      blockNameMapping,
      blockOutputSchemas,
      workflowVariables,
      lang
    )
    /**
     * Pre-resolved block outputs take precedence because the executor produced them with the
     * complete loop/parallel scope. Environment placeholders remain untouched until this point,
     * so Custom Tools and visual Function blocks share exactly one compiler.
     */
    const contextVariables: Record<string, unknown> = {
      ...codeResolution.contextVariables,
      ...preResolvedContextVariables,
    }

    /**
     * Files this run must place on the sandbox filesystem: those a caller passed
     * explicitly — how an agent supplies one, since a model cannot write a block
     * reference — plus every file the code asked for with `<block.file.path>`,
     * which arrives as a marker inside the resolved context variables.
     */
    const plannedFileMounts = planUserFileMounts([
      ...((mountedUserFiles ?? []) as UserFile[]),
      ...collectSandboxFileMountRefs(contextVariables),
    ])
    if (plannedFileMounts.length > MAX_BLOCK_MOUNTED_FILES) {
      return functionJsonResponse(
        {
          success: false,
          error: `Too many files mounted into the sandbox (${plannedFileMounts.length}). Maximum is ${MAX_BLOCK_MOUNTED_FILES}.`,
          output: { result: null, stdout: '', executionTime: Date.now() - startTime },
        },
        routeContext,
        { status: 400 }
      )
    }
    const requestsSandboxFilesystem =
      plannedFileMounts.length > 0 ||
      Boolean(_sandboxFiles?.length) ||
      outputSandboxPaths.length > 0 ||
      Boolean(outputSandboxPath)

    const compilation = await compileCodePlaceholders({
      code: codeResolution.resolvedCode,
      language: lang,
      params: executionParams,
      environmentVariables: envVars,
      reservedNames: Object.keys(contextVariables),
    })
    for (const name of compilation.resolvedSecretNames) {
      if (!Object.hasOwn(envVars, name)) continue
      const plaintext = envVars[name]
      if (!plaintext) continue
      routeContext.outputSecretPlaintextsByName.set(name, plaintext)
      /**
       * Skipped per NAME, never per literal: a plaintext shared by an exempt and a non-exempt
       * name keeps its literal through the non-exempt owner, so the export still records that
       * owner's provenance and the file still locks.
       */
      if (routeContext.unredactedSecretNames.has(name)) continue
      const scanLiterals = new Set([plaintext, JSON.stringify(plaintext).slice(1, -1)])
      for (const scanLiteral of scanLiterals) {
        const names = routeContext.outputSecretNamesByScanLiteral.get(scanLiteral) ?? []
        names.push(name)
        routeContext.outputSecretNamesByScanLiteral.set(scanLiteral, names)
      }
    }
    if (routeContext.outputSecretNamesByScanLiteral.size > 0) {
      try {
        routeContext.outputSecretMatcher = createResolvedSecretMatcher(
          [...routeContext.outputSecretNamesByScanLiteral].map(([plaintext, names]) => ({
            plaintext,
            replacement: `{{${[...names].sort()[0]}}}`,
          }))
        )
      } catch {
        activateReferencedSecretProvenance(routeContext)
      }
    }
    resolvedCode = compilation.code
    compilerInternalIdentifiers = [...compilation.internalIdentifiers]
    compilerPrivateInputs = [...compilation.privateInputs]
    compilerRuntimeBindings = [...compilation.runtimeBindings]
    for (const binding of compilation.bindings) {
      setRecordValue(contextVariables, binding.name, binding.value)
    }
    if (lang === CodeLanguage.Shell && containsLargeValueRef(contextVariables)) {
      throw new Error(
        'Large execution values require the JavaScript isolated-vm runtime. Select a nested field or read the value in a JavaScript function.'
      )
    }

    let jsImports = ''
    let jsRemainingCode = resolvedCode
    let jsIdentifierNames: ReadonlySet<string> = new Set()
    let hasImports = false

    if (lang === CodeLanguage.JavaScript) {
      const extractionResult = await extractJavaScriptImports(resolvedCode)
      jsImports = extractionResult.imports
      jsRemainingCode = extractionResult.remainingCode
      jsIdentifierNames = extractionResult.identifierNames

      hasImports = jsImports.trim().length > 0 || extractionResult.hasRequireCalls
    }

    if (lang === CodeLanguage.Shell && !remoteSandboxEnabled) {
      throw new Error(
        'Shell execution requires a remote code sandbox to be enabled. Please contact your administrator to enable it.'
      )
    }

    if (lang === CodeLanguage.Python && !remoteSandboxEnabled) {
      throw new Error(
        'Python execution requires a remote code sandbox to be enabled. Please contact your administrator to enable it, or use JavaScript instead.'
      )
    }

    if (lang === CodeLanguage.JavaScript && hasImports && !remoteSandboxEnabled) {
      throw new Error(
        'JavaScript code with import statements requires a remote code sandbox to be enabled. Please remove the import statements, or contact your administrator to enable it.'
      )
    }

    /**
     * Mounting files or harvesting outputs needs a real filesystem, so it selects
     * the remote sandbox the same way a selected sandbox image does. Without this
     * a plain-JavaScript block that merely attaches a file would land in
     * isolated-vm and be refused by the guard below — a dead end, since "add an
     * import" is not a fix a caller should have to discover.
     */
    const useRemoteSandbox =
      usesMothershipSandbox ||
      (remoteSandboxEnabled &&
        !isCustomTool &&
        (lang === CodeLanguage.Shell ||
          lang === CodeLanguage.Python ||
          (lang === CodeLanguage.JavaScript &&
            (hasImports || Boolean(selectedSandboxId) || requestsSandboxFilesystem))))

    if (useRemoteSandbox && containsLargeValueRef(contextVariables)) {
      throw new Error(
        'Large execution values require the JavaScript isolated-vm runtime. Remove imports, select a nested field, or read the value in a JavaScript function without a remote sandbox.'
      )
    }

    // Sandbox file mounts and file exports only exist in the remote sandbox
    // runtime; isolated-vm has no filesystem. Silently dropping a declared
    // sandbox input/output here produced "export succeeded" responses with zero
    // bytes written, so refuse the call instead. Widening `useRemoteSandbox`
    // above means the only ways to arrive here are a deployment with no remote
    // sandbox at all, or a custom tool — which is why neither remediation
    // suggests switching language.
    if (!useRemoteSandbox && requestsSandboxFilesystem) {
      const remediation = !remoteSandboxEnabled
        ? "No remote code sandbox is enabled on this deployment, so there is no sandbox filesystem for any language. Pass input data via params and return output as the code's return value with outputs.files[].path (no sandboxPath)."
        : "custom tools always run in the isolated JavaScript VM, which has no sandbox filesystem. Pass input data via params and return output as the code's return value."
      return functionJsonResponse(
        {
          success: false,
          error: `Sandbox file inputs/outputs are unavailable for this call: ${remediation}`,
          output: { result: null, stdout: '', executionTime: Date.now() - startTime },
        },
        routeContext,
        { status: 422 }
      )
    }

    // Resolved only after the guard: a request about to be refused must not mint
    // presigned URLs or buffer bytes on its way out.
    let resolvedMounts: Awaited<ReturnType<typeof resolveUserFileMounts>>
    try {
      resolvedMounts = await resolveUserFileMounts({
        planned: plannedFileMounts,
        context: {
          principal: auth.principal,
          workflowId,
          workspaceId,
          executionId,
          largeValueExecutionIds,
          largeValueKeys,
          fileKeys,
          allowLargeValueWorkflowScope,
          userId: auth.fileAccessUserId,
          requestId,
          logger,
        },
      })
    } catch (error) {
      // Everything this can raise is about the files the caller named — a mount
      // it may not read, one over a size ceiling, a set over the aggregate. The
      // messages already say which file and what to do, so they are the response
      // rather than a 500 that reads like the platform broke. Matches the
      // too-many-files refusal above.
      logger.warn(`[${requestId}] Could not resolve sandbox file mounts`, {
        error: getErrorMessage(error),
      })
      return functionJsonResponse(
        {
          success: false,
          error: getErrorMessage(error, 'Could not mount the requested files into the sandbox.'),
          output: { result: null, stdout: '', executionTime: Date.now() - startTime },
        },
        routeContext,
        { status: 400 }
      )
    }
    const { sandboxFiles: userFileMounts, manifest: mountManifest } = resolvedMounts
    const sandboxFiles = mergeSandboxFileMounts(_sandboxFiles, userFileMounts)

    // Every `<block.file.path>` marker becomes the path its file was mounted at,
    // so the code reads a plain string in whichever language it is written in.
    const mountPathsByKey = new Map(
      plannedFileMounts.map(({ userFile, mountPath }) => [userFile.key, mountPath])
    )
    for (const [name, value] of Object.entries(contextVariables)) {
      contextVariables[name] = replaceSandboxFileMountRefs(
        value,
        (file) => mountPathsByKey.get(file.key) ?? file.name
      )
    }

    // Harvested on every remote run rather than behind a switch: the directory is
    // Sim's own, so nothing lands there unless the code put it there, and the cost
    // is one listing on a run that already paid for a sandbox. Isolate runs never
    // reach here, so they stay as fast as they were.
    //
    // Declared sandbox outputs opt out. That request names exactly which paths to
    // export and answers with that export's own result, so harvesting alongside it
    // would collect files the response has no shape to carry — they would be read,
    // scanned, uploaded, and then dropped. Making the exclusion explicit here keeps
    // it from resting on which branch happens to return first.
    const declaresSandboxOutputs = outputFiles.some((file) => file.sandboxPath)
    const outputSandboxDir =
      useRemoteSandbox && !declaresSandboxOutputs ? SANDBOX_OUTPUT_DIR : undefined

    if (mountManifest.length > 0) {
      logger.info(`[${requestId}] Mounted files into sandbox`, {
        mountCount: mountManifest.length,
      })
    }

    if (lang === CodeLanguage.Shell) {
      const shellEnvs: Record<string, string> = {}
      for (const [k, v] of Object.entries(envVars)) {
        shellEnvs[k] = serializeForShellEnv(v)
      }
      for (const [k, v] of Object.entries(contextVariables)) {
        shellEnvs[k] = serializeForShellEnv(v, 'null')
      }

      logger.info(`[${requestId}] E2B shell execution`, {
        enabled: remoteSandboxEnabled,
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
        exportedFiles,
        collectedFiles: shellCollectedFiles,
      } = await executeShellInSandbox({
        code: resolvedCode,
        envs: shellEnvs,
        timeoutMs: timeout,
        sandboxFiles,
        privateInputs: compilerPrivateInputs,
        outputSandboxPath,
        outputSandboxPaths,
        outputSandboxDir,
        workspaceId,
        sandboxId: selectedSandboxId,
        ...(usesMothershipSandbox && !selectedSandboxId
          ? { sandboxKind: 'mothership' as const }
          : {}),
        signal: executionSignal,
      })
      const executionTime = Date.now() - execStart

      logger.info(`[${requestId}] E2B shell sandbox`, {
        sandboxId,
        succeeded: !shellError,
        executionTime,
      })

      if (shellError) {
        return functionJsonResponse(
          {
            success: false,
            error: scrubInternalIdentifiers(shellError, compilerInternalIdentifiers),
            output: { result: null, stdout: cleanStdout(shellStdout), executionTime },
          },
          routeContext,
          { status: 422 }
        )
      }

      if (outputSandboxPaths.length > 0 || outputSandboxPath) {
        const fileExportResponse = await maybeExportSandboxFilesToWorkspace({
          routeContext,
          authUserId: auth.attributedUserId,
          workflowId,
          workspaceId,
          outputFiles,
          exportedFiles,
          exportedFileContent,
          stdout: shellStdout,
          executionTime,
        })
        if (fileExportResponse) {
          return appendResolvedSecretNames(fileExportResponse, routeContext)
        }
      }

      const shellOutputFiles = await collectExecutionOutputFiles({
        routeContext,
        authUserId: auth.attributedUserId,
        workflowId,
        workspaceId,
        executionId,
        collectedFiles: shellCollectedFiles ?? [],
        stdout: shellStdout,
        executionTime,
      })
      if ('response' in shellOutputFiles) {
        return appendResolvedSecretNames(shellOutputFiles.response, routeContext)
      }

      return functionJsonResponse(
        {
          success: true,
          output: {
            result: shellResult ?? null,
            stdout: cleanStdout(shellStdout),
            executionTime,
            files: shellOutputFiles.files,
          },
        },
        routeContext
      )
    }

    if (useRemoteSandbox) {
      logger.info(`[${requestId}] E2B status`, {
        enabled: remoteSandboxEnabled,
        hasApiKey: Boolean(process.env.E2B_API_KEY),
        language: lang,
      })
      if (lang === CodeLanguage.JavaScript) {
        const imports = jsImports
        const remainingCode = jsRemainingCode

        const importSection: string = imports ? `${imports}\n` : ''
        const importLineCount = imports ? imports.split('\n').length : 0

        const codeBody = remainingCode
        resolvedCode = importSection ? `${imports}\n\n${codeBody}` : codeBody
        const runtime = buildJavaScriptSandboxRuntime(
          resolvedCode,
          Object.keys(contextVariables),
          compilerRuntimeBindings,
          jsIdentifierNames
        )
        compilerInternalIdentifiers.push(...runtime.internalIdentifiers)
        const runtimePrivateInput = createSandboxRuntimePrivateInput({
          params: executionParams,
          environmentVariables: envVars,
          contextVariables: encodeSandboxRuntimeContextVariables(contextVariables),
        })

        const wrapped = [
          ';(async () => {',
          '  try {',
          '    const __sim_result = await (async () => {',
          `      ${codeBody.split('\n').join('\n      ')}`,
          '    })();',
          // Leading \n guarantees the marker starts a fresh line even when user
          // code's last stdout write was not newline-terminated (chunks are
          // concatenated verbatim on the parse side, so a glued marker would
          // otherwise be missed silently).
          `    console.log('\\n${SIM_RESULT_PREFIX}' + JSON.stringify(__sim_result));`,
          '  } catch (error) {',
          '    console.log(String((error && (error.stack || error.message)) || error));',
          '    throw error;',
          '  }',
          '})();',
        ].join('\n')
        const codeForE2B = runtime.importSource + importSection + runtime.prologue + wrapped

        const execStart = Date.now()
        const {
          result: e2bResult,
          stdout: e2bStdout,
          sandboxId,
          error: e2bError,
          exportedFileContent,
          exportedFiles,
          collectedFiles: jsCollectedFiles,
        } = await executeInSandbox({
          code: codeForE2B,
          language: CodeLanguage.JavaScript,
          timeoutMs: timeout,
          sandboxFiles,
          privateInputs: [...compilerPrivateInputs, runtimePrivateInput],
          runtimeBindings: compilerRuntimeBindings,
          outputSandboxPath,
          outputSandboxPaths,
          outputSandboxDir,
          workspaceId,
          sandboxId: selectedSandboxId,
          ...(usesMothershipSandbox && !selectedSandboxId
            ? { sandboxKind: 'mothership' as const }
            : {}),
          signal: executionSignal,
        })
        const executionTime = Date.now() - execStart
        stdout += e2bStdout

        logger.info(`[${requestId}] E2B JS sandbox`, {
          sandboxId,
          succeeded: !e2bError,
        })

        if (e2bError) {
          const errorDisplayCode = getErrorDisplayCode(sourceCodeForErrors, resolvedCode)
          const { formattedError, cleanedOutput } = formatE2BError(
            scrubInternalIdentifiers(
              getErrorDisplayMessage(e2bError, sourceCodeForErrors, resolvedCode),
              compilerInternalIdentifiers
            ),
            e2bStdout,
            lang,
            errorDisplayCode,
            runtime.lineCount + importLineCount
          )
          return functionJsonResponse(
            {
              success: false,
              error: formattedError,
              output: { result: null, stdout: cleanedOutput, executionTime },
            },
            routeContext,
            { status: 422 }
          )
        }

        if (outputSandboxPaths.length > 0 || outputSandboxPath) {
          const fileExportResponse = await maybeExportSandboxFilesToWorkspace({
            routeContext,
            authUserId: auth.attributedUserId,
            workflowId,
            workspaceId,
            outputFiles,
            exportedFiles,
            exportedFileContent,
            stdout,
            executionTime,
          })
          if (fileExportResponse) {
            return appendResolvedSecretNames(fileExportResponse, routeContext)
          }
        }

        const jsOutputFiles = await collectExecutionOutputFiles({
          routeContext,
          authUserId: auth.attributedUserId,
          workflowId,
          workspaceId,
          executionId,
          collectedFiles: jsCollectedFiles ?? [],
          stdout,
          executionTime,
        })
        if ('response' in jsOutputFiles) {
          return appendResolvedSecretNames(jsOutputFiles.response, routeContext)
        }

        return functionJsonResponse(
          {
            success: true,
            output: {
              result: e2bResult ?? null,
              stdout: cleanStdout(stdout),
              executionTime,
              files: jsOutputFiles.files,
            },
          },
          routeContext
        )
      }

      const runtime = buildPythonSandboxRuntime(resolvedCode, Object.keys(contextVariables))
      compilerInternalIdentifiers.push(...runtime.internalIdentifiers)
      const runtimePrivateInput = createSandboxRuntimePrivateInput({
        params: executionParams,
        environmentVariables: envVars,
        contextVariables: encodeSandboxRuntimeContextVariables(contextVariables),
      })
      const wrapped = buildPythonSandboxWrapper(resolvedCode)
      const codeForE2B = runtime.prologue + wrapped

      const execStart = Date.now()
      const {
        result: e2bResult,
        stdout: e2bStdout,
        sandboxId,
        error: e2bError,
        exportedFileContent,
        exportedFiles,
        collectedFiles: pythonCollectedFiles,
      } = await executeInSandbox({
        code: codeForE2B,
        language: CodeLanguage.Python,
        timeoutMs: timeout,
        sandboxFiles,
        privateInputs: [...compilerPrivateInputs, runtimePrivateInput],
        outputSandboxPath,
        outputSandboxPaths,
        outputSandboxDir,
        workspaceId,
        sandboxId: selectedSandboxId,
        ...(usesMothershipSandbox && !selectedSandboxId
          ? { sandboxKind: 'mothership' as const }
          : {}),
        signal: executionSignal,
      })
      const executionTime = Date.now() - execStart
      stdout += e2bStdout

      logger.info(`[${requestId}] E2B Py sandbox`, {
        sandboxId,
        succeeded: !e2bError,
      })

      if (e2bError) {
        const errorDisplayCode = getErrorDisplayCode(sourceCodeForErrors, resolvedCode)
        const { formattedError, cleanedOutput } = formatE2BError(
          scrubInternalIdentifiers(
            getErrorDisplayMessage(e2bError, sourceCodeForErrors, resolvedCode),
            compilerInternalIdentifiers
          ),
          e2bStdout,
          lang,
          errorDisplayCode,
          runtime.lineCount
        )
        return functionJsonResponse(
          {
            success: false,
            error: formattedError,
            output: { result: null, stdout: cleanedOutput, executionTime },
          },
          routeContext,
          { status: 422 }
        )
      }

      if (outputSandboxPaths.length > 0 || outputSandboxPath) {
        const fileExportResponse = await maybeExportSandboxFilesToWorkspace({
          routeContext,
          authUserId: auth.attributedUserId,
          workflowId,
          workspaceId,
          outputFiles,
          exportedFiles,
          exportedFileContent,
          stdout,
          executionTime,
        })
        if (fileExportResponse) {
          return appendResolvedSecretNames(fileExportResponse, routeContext)
        }
      }

      const pythonOutputFiles = await collectExecutionOutputFiles({
        routeContext,
        authUserId: auth.attributedUserId,
        workflowId,
        workspaceId,
        executionId,
        collectedFiles: pythonCollectedFiles ?? [],
        stdout,
        executionTime,
      })
      if ('response' in pythonOutputFiles) {
        return appendResolvedSecretNames(pythonOutputFiles.response, routeContext)
      }

      return functionJsonResponse(
        {
          success: true,
          output: {
            result: e2bResult ?? null,
            stdout: cleanStdout(stdout),
            executionTime,
            files: pythonOutputFiles.files,
          },
        },
        routeContext
      )
    }

    const executionMethod = 'isolated-vm'

    const isSafeParamKey = (key: string) =>
      key !== 'params' && SAFE_IDENTIFIER.test(key) && !JS_RESERVED_WORDS.has(key)
    const customToolParamKeys = isCustomTool
      ? Object.keys(executionParams).filter((key) => {
          const safe = isSafeParamKey(key)
          if (!safe)
            logger.warn('Skipping param key — not a safe JS identifier', { key, requestId })
          return safe
        })
      : []
    userCodeStartLine = customToolParamKeys.length + 3

    let codeToExecute = resolvedCode
    const prependedLineCount = customToolParamKeys.length
    if (customToolParamKeys.length > 0) {
      const paramDestructuring = customToolParamKeys
        .map((key) => `const ${key} = params.${key};`)
        .join('\n')
      codeToExecute = `${paramDestructuring}\n${resolvedCode}`
    }

    const isolatedResult = await executeInIsolatedVM(
      {
        code: codeToExecute,
        params: executionParams,
        envVars,
        contextVariables,
        runtimeBindings: compilerRuntimeBindings,
        timeoutMs: timeout,
        requestId,
        ownerKey: `user:${auth.attributedUserId}`,
        ownerWeight: 1,
      },
      { brokers: createFunctionRuntimeBrokers(routeContext), signal: executionSignal }
    )

    const executionTime = Date.now() - startTime
    stdout = isolatedResult.stdout

    if (isolatedResult.error) {
      if (isolatedResult.termination === 'timeout') {
        throw new DOMException('timeout', 'AbortError')
      }
      if (isolatedResult.termination === 'cancelled') {
        throw executionSignal.reason instanceof Error
          ? executionSignal.reason
          : new DOMException('user', 'AbortError')
      }

      const isSystemError = isolatedResult.error.isSystemError === true
      const logFn = isSystemError ? logger.error.bind(logger) : logger.warn.bind(logger)
      logFn(`[${requestId}] Function execution failed in isolated-vm`, {
        executionTime,
        isSystemError,
        hasStack: Boolean(isolatedResult.error.stack),
      })

      const ivmError = isolatedResult.error
      let adjustedLine = ivmError.line
      let adjustedLineContent = ivmError.lineContent
      if (prependedLineCount > 0 && ivmError.line !== undefined) {
        adjustedLine = Math.max(1, ivmError.line - prependedLineCount)
      }
      const errorDisplayCode = getErrorDisplayCode(sourceCodeForErrors, resolvedCode)
      const displayMessage = scrubInternalIdentifiers(
        getErrorDisplayMessage(ivmError.message, sourceCodeForErrors, resolvedCode),
        compilerInternalIdentifiers
      )
      adjustedLineContent = getLineContent(errorDisplayCode, adjustedLine) ?? adjustedLineContent
      const enhancedError: EnhancedError = {
        message: displayMessage,
        name: ivmError.name,
        stack: ivmError.stack
          ? scrubInternalIdentifiers(ivmError.stack, compilerInternalIdentifiers)
          : undefined,
        line: adjustedLine,
        column: ivmError.column,
        lineContent: adjustedLineContent,
      }

      const userFriendlyErrorMessage = createUserFriendlyErrorMessage(
        enhancedError,
        errorDisplayCode
      )

      const detailLogFn = isSystemError ? logger.error.bind(logger) : logger.warn.bind(logger)
      detailLogFn(`[${requestId}] Enhanced error details`, {
        line: enhancedError.line,
        column: enhancedError.column,
      })

      return functionJsonResponse(
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
        routeContext,
        { status: isSystemError ? 500 : 422 }
      )
    }

    logger.info(`[${requestId}] Function executed successfully using ${executionMethod}`, {
      executionTime,
    })

    return functionJsonResponse(
      {
        success: true,
        output: { result: isolatedResult.result, stdout: cleanStdout(stdout), executionTime },
      },
      routeContext
    )
  } catch (error: any) {
    const executionTime = Date.now() - startTime
    if (executionSignal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      const timedOut =
        executionDeadlineController?.isTimedOut() === true ||
        isTimeoutAbortReason(executionSignal.reason) ||
        isTimeoutAbortReason(req.signal.reason) ||
        isTimeoutAbortReason(error?.cause ?? error) ||
        (executionDeadlineAt !== undefined && Date.now() >= executionDeadlineAt)
      const abortResponse = {
        success: false,
        error: timedOut
          ? `Function execution timed out${timeoutForError ? ` after ${timeoutForError}ms` : ''}`
          : 'Function execution was cancelled',
        output: { result: null, stdout: cleanStdout(stdout), executionTime },
      }
      logger.warn(`[${requestId}] Function execution ${timedOut ? 'timed out' : 'was cancelled'}`, {
        executionTime,
      })
      return routeContext
        ? functionJsonResponse(abortResponse, routeContext, { status: timedOut ? 408 : 499 })
        : appendPrivateResolvedSecretNames(
            NextResponse.json(abortResponse, { status: timedOut ? 408 : 499 }),
            includePrivateResolvedSecretNames ? [] : null,
            privateResolvedSecretNamesMetadataType
          )
    }
    if (error instanceof CodePlaceholderCompileError) {
      const compilerResponse = {
        success: false,
        error: scrubInternalIdentifiers(error.message, compilerInternalIdentifiers),
        output: { result: null, stdout: cleanStdout(stdout), executionTime },
        debug: {
          line: error.line,
          column: error.column,
          errorType: error.name,
          lineContent: getLineContent(sourceCodeForErrors ?? '', error.line),
        },
      }
      return routeContext
        ? functionJsonResponse(compilerResponse, routeContext, { status: 422 })
        : appendPrivateResolvedSecretNames(
            NextResponse.json(compilerResponse, { status: 422 }),
            includePrivateResolvedSecretNames ? [] : null,
            privateResolvedSecretNamesMetadataType
          )
    }
    if (
      isSandboxOutputLimitError(error) ||
      isSandboxOutputFileError(error) ||
      isSandboxOutputNotExportableError(error)
    ) {
      const outputLimitResponse = {
        success: false,
        error: error.message,
        output: { result: null, stdout: cleanStdout(stdout), executionTime },
      }
      return routeContext
        ? functionJsonResponse(outputLimitResponse, routeContext, { status: 400 })
        : appendPrivateResolvedSecretNames(
            NextResponse.json(outputLimitResponse, { status: 400 }),
            includePrivateResolvedSecretNames ? [] : null,
            privateResolvedSecretNamesMetadataType
          )
    }
    if (isExecutionResourceLimitError(error)) {
      logger.warn(`[${requestId}] Function execution exceeded resource limits`, {
        resource: error.resource,
        attemptedBytes: error.attemptedBytes,
        limitBytes: error.limitBytes,
        executionTime,
      })
      if (routeContext) {
        return functionJsonResponse(
          {
            success: false,
            error: error.message,
            output: {
              result: null,
              stdout: cleanStdout(stdout),
              executionTime,
            },
          },
          routeContext,
          { status: error.statusCode }
        )
      }
      return appendPrivateResolvedSecretNames(
        NextResponse.json(
          {
            success: false,
            error: error.message,
            output: {
              result: null,
              stdout: cleanStdout(stdout),
              executionTime,
            },
          },
          { status: error.statusCode }
        ),
        includePrivateResolvedSecretNames ? [] : null,
        privateResolvedSecretNamesMetadataType
      )
    }

    if (isSandboxLaunchIndeterminateError(error)) {
      const indeterminateResponse = {
        success: false,
        error: getErrorMessage(error),
        retryable: false,
        code: 'sandbox_launch_indeterminate',
        output: { result: null, stdout: cleanStdout(stdout), executionTime },
      }
      return routeContext
        ? functionJsonResponse(indeterminateResponse, routeContext, { status: 503 })
        : appendPrivateResolvedSecretNames(
            NextResponse.json(indeterminateResponse, { status: 503 }),
            includePrivateResolvedSecretNames ? [] : null,
            privateResolvedSecretNamesMetadataType
          )
    }

    if (isLikelySandboxKill(error)) {
      const underlying = scrubInternalIdentifiers(
        (error?.message || String(error)).slice(0, 300),
        compilerInternalIdentifiers
      )
      logger.warn(`[${requestId}] Sandbox terminated before completion (likely OOM or timeout)`, {
        executionTime,
      })
      const killResponse = {
        success: false,
        error:
          'The sandbox was terminated before finishing — most likely it ran out of memory or hit the time limit while processing large or combined inputs. Mount and process fewer/smaller files at once (e.g. one file at a time), or stream and aggregate incrementally instead of loading everything into memory. ' +
          `(underlying: ${underlying || 'no detail; sandbox died'})`,
        output: { result: null, stdout: cleanStdout(stdout), executionTime },
      }
      return routeContext
        ? functionJsonResponse(killResponse, routeContext, { status: 500 })
        : appendPrivateResolvedSecretNames(
            NextResponse.json(killResponse, { status: 500 }),
            includePrivateResolvedSecretNames ? [] : null,
            privateResolvedSecretNamesMetadataType
          )
    }

    logger.error(`[${requestId}] Function execution failed`, {
      executionTime,
      hasStack: Boolean(error.stack),
    })

    const errorDisplayCode = getErrorDisplayCode(sourceCodeForErrors, resolvedCode)
    const enhancedError = extractEnhancedError(error, userCodeStartLine, errorDisplayCode)
    const userFriendlyErrorMessage = scrubInternalIdentifiers(
      createUserFriendlyErrorMessage(enhancedError, errorDisplayCode),
      compilerInternalIdentifiers
    )

    logger.error(`[${requestId}] Enhanced error details`, {
      line: enhancedError.line,
      column: enhancedError.column,
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
        lineContent: enhancedError.lineContent
          ? scrubInternalIdentifiers(enhancedError.lineContent, compilerInternalIdentifiers)
          : undefined,
        stack: enhancedError.stack
          ? scrubInternalIdentifiers(enhancedError.stack, compilerInternalIdentifiers)
          : undefined,
      },
    }

    if (routeContext) {
      return functionJsonResponse(errorResponse, routeContext, { status: 500 })
    }

    return appendPrivateResolvedSecretNames(
      NextResponse.json(errorResponse, { status: 500 }),
      includePrivateResolvedSecretNames ? [] : null,
      privateResolvedSecretNamesMetadataType
    )
  } finally {
    executionDeadlineController?.cleanup()
  }
}
