import { Script } from 'node:vm'
import { getErrorMessage } from '@sim/utils/errors'
import { findWorkflowReferenceTokens } from '@sim/utils/workflow-references'
import type { BlockState } from '@sim/workflow-types/workflow'
import { collectCodePlaceholderOccurrences } from '@/lib/execution/code-placeholders/shared'
import { collectJavaScriptImportSegments } from '@/lib/execution/javascript-imports'
import type { WorkflowLintCheck, WorkflowLintCodeIssue } from '@/lib/workflows/editing/lint'

const MAX_CODE_BYTES = 1024 * 1024
const MAX_TOTAL_CODE_BYTES = 8 * MAX_CODE_BYTES

/**
 * Parses JavaScript Function bodies without executing them or resolving secrets. The native
 * parser catches invalid regex flags that TypeScript's recovery parser accepts. Static imports
 * are parsed and removed before checking the async body, matching the execution wrapper.
 */
export async function collectWorkflowCodeSyntax(blocks: Record<string, BlockState>): Promise<{
  issues: WorkflowLintCodeIssue[]
  check: WorkflowLintCheck
}> {
  const issues: WorkflowLintCodeIssue[] = []
  let checked = 0
  let unsupported = 0
  let oversized = 0
  let bytesChecked = 0
  let templated = 0
  let parserFailures = 0

  for (const [blockId, block] of Object.entries(blocks)) {
    if (block.type !== 'function' || block.enabled === false) continue
    const code = block.subBlocks.code?.value
    if (typeof code !== 'string' || !code.trim()) continue
    const language = block.subBlocks.language?.value || 'javascript'
    if (language !== 'javascript') {
      unsupported++
      continue
    }
    const bytes = Buffer.byteLength(code)
    if (bytes > MAX_CODE_BYTES || bytesChecked + bytes > MAX_TOTAL_CODE_BYTES) {
      oversized++
      continue
    }
    bytesChecked += bytes
    checked++
    let tokens: { start: number; end: number }[]
    try {
      tokens = [
        ...findWorkflowReferenceTokens(code).filter((token) => token.kind === 'workflow'),
        ...collectCodePlaceholderOccurrences(code),
      ]
    } catch (error) {
      issues.push(
        codeIssue(blockId, block, error, getErrorMessage(error, 'Invalid variable placeholders'))
      )
      continue
    }
    if (tokens.length) templated++
    let masked = maskRanges(code, tokens, '_')
    try {
      compileBody(masked)
      continue
    } catch (error) {
      /** Most bodies need only the native parser; load TypeScript only for imports or templates. */
      if (!/\bimport\b/.test(masked) && tokens.length === 0) {
        issues.push(codeIssue(blockId, block, error))
        continue
      }
    }

    try {
      const ts = await import('@typescript/typescript6')
      const parsed = ts.createSourceFile(
        'workflow-code.js',
        masked,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS
      )
      const diagnostics = Reflect.get(parsed, 'parseDiagnostics') as
        | readonly import('@typescript/typescript6').Diagnostic[]
        | undefined
      const diagnostic = diagnostics?.[0]
      if (diagnostic) {
        const position = parsed.getLineAndCharacterOfPosition(diagnostic.start ?? 0)
        issues.push({
          blockId,
          blockName: block.name,
          blockType: block.type,
          field: 'code',
          language: 'javascript',
          message: `Invalid JavaScript syntax (TS${diagnostic.code})`,
          line: position.line + 1,
          column: position.character + 1,
        })
        continue
      }

      /** Import declarations live outside the async execution body; keep offsets for diagnostics. */
      const edits = collectJavaScriptImportSegments(parsed, ts).map(({ start, end }) => ({
        start,
        end,
      }))
      /** Dynamic regex flags are values, not statically checkable JavaScript flags. */
      const visit = (node: import('@typescript/typescript6').Node): void => {
        if (ts.isRegularExpressionLiteral(node)) {
          const start = node.getStart(parsed)
          const flagsStart = start + node.getText(parsed).lastIndexOf('/') + 1
          let low = 0
          let high = tokens.length
          while (low < high) {
            const middle = (low + high) >>> 1
            if (tokens[middle].start < flagsStart) low = middle + 1
            else high = middle
          }
          for (
            let index = low;
            index < tokens.length && tokens[index].end <= node.getEnd();
            index++
          ) {
            edits.push(tokens[index])
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(parsed)
      masked = maskRanges(masked, edits, ' ')
      try {
        compileBody(masked)
      } catch (error) {
        issues.push(codeIssue(blockId, block, error))
      }
    } catch {
      /** Excessively nested syntax can exceed parser limits; advisory lint must still return. */
      parserFailures++
    }
  }

  return {
    issues,
    check: {
      name: 'embedded-code-syntax',
      status: unsupported || oversized || templated || parserFailures ? 'partial' : 'complete',
      detail: `Parsed ${checked} enabled JavaScript Function bodies without execution. ${templated} used placeholder values; resolved values are not checked. Skipped ${unsupported} non-JavaScript bodies and ${oversized} bodies exceeding the 1 MiB per-body or 8 MiB total parse budget. ${parserFailures} bodies could not be parsed within parser limits; simplify deeply nested code and retry. Python, Shell, generated source, dependency availability, and runtime behavior are not validated.`,
    },
  }
}

/** Compilation only: the returned script is never run. */
function compileBody(code: string): void {
  new Script(`(async () => {\n${code}\n})`, {
    filename: 'workflow-code.js',
  })
}

function codeIssue(
  blockId: string,
  block: BlockState,
  error: unknown,
  placeholderMessage?: string
): WorkflowLintCodeIssue {
  const parserMessage = getErrorMessage(error)
  /** Parser messages can interpolate arbitrary source; expose only fixed syntax categories. */
  const message =
    placeholderMessage ??
    (parserMessage === 'Invalid regular expression flags'
      ? parserMessage
      : parserMessage.startsWith('Invalid regular expression')
        ? 'Invalid regular expression literal'
        : 'Invalid JavaScript syntax')
  const stack = error instanceof Error ? error.stack : undefined
  const line = /^workflow-code\.js:(\d+)/.exec(stack ?? '')?.[1]
  const caret = stack?.split('\n')[2]?.indexOf('^')
  return {
    blockId,
    blockName: block.name,
    blockType: block.type,
    field: 'code',
    language: 'javascript',
    message,
    ...(line ? { line: Math.max(1, Number(line) - 1) } : {}),
    ...(caret !== undefined && caret >= 0 ? { column: caret + 1 } : {}),
  }
}

/** Preserves offsets and line breaks without copying the full body once per placeholder. */
function maskRanges(
  code: string,
  ranges: { start: number; end: number }[],
  character: string
): string {
  const parts: string[] = []
  let cursor = 0
  for (const range of ranges.sort((left, right) => left.start - right.start)) {
    if (range.end <= cursor) continue
    const start = Math.max(cursor, range.start)
    parts.push(
      code.slice(cursor, start),
      code.slice(start, range.end).replace(/[^\r\n]/g, character)
    )
    cursor = range.end
  }
  parts.push(code.slice(cursor))
  return parts.join('')
}
