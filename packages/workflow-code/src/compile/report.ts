import type { CompileDiagnosticCode } from '../diagnostics/codes'
import {
  codeFrame,
  type LocatedDiagnostic,
  type SourceSpan,
  splitLines,
} from '../diagnostics/frame'
import type { BlockKey, SubBlockId } from '../model'

/** Babel's line terminators (`lineBreak` in @babel/parser), so lines agree with Babel `loc`. */
const LINE_BREAK = /\r\n|[\n\r\u2028\u2029]/g

/** Line start offsets of one file, for offset → line/column. */
class LineIndex {
  private readonly starts: number[] = [0]
  private split: string[] | null = null

  constructor(readonly text: string) {
    for (const match of text.matchAll(LINE_BREAK)) {
      this.starts.push(match.index + match[0].length)
    }
  }

  /** The file's lines, split once on first use. */
  get lines(): readonly string[] {
    this.split ??= splitLines(this.text)
    return this.split
  }

  /** 1-based line and UTF-16 column of an offset. */
  position(offset: number): { line: number; column: number } {
    const clamped = Math.min(Math.max(offset, 0), this.text.length)
    let low = 0
    let high = this.starts.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (this.starts[mid] <= clamped) low = mid
      else high = mid - 1
    }
    return { line: low + 1, column: clamped - this.starts[low] + 1 }
  }
}

/** An offset range in one file. */
export interface Range {
  file: string
  start: number
  end: number
}

interface ReportExtras {
  hint?: string
  blockKey?: BlockKey
  param?: SubBlockId
  related?: Array<{ at: Range; message: string }>
}

type SeverityOfCode = LocatedDiagnostic<CompileDiagnosticCode>['severity']

function severityOf(code: CompileDiagnosticCode): SeverityOfCode {
  return code.startsWith('E_') ? 'error' : 'warning'
}

/**
 * Collects located diagnostics for every file a compile reads. Each diagnostic gets its span (from
 * offsets) and code frame here, so no other module computes line numbers.
 */
export class Reporter {
  readonly diagnostics: LocatedDiagnostic<CompileDiagnosticCode>[] = []
  private readonly indexes = new Map<string, LineIndex>()
  private errorCount = 0

  addFile(path: string, text: string): void {
    this.indexes.set(path, new LineIndex(text))
  }

  get hasErrors(): boolean {
    return this.errorCount > 0
  }

  span(at: Range): SourceSpan {
    const index = this.indexes.get(at.file) ?? new LineIndex('')
    const end = Math.max(at.end, at.start)
    const startPosition = index.position(at.start)
    const endPosition = index.position(end)
    return {
      file: at.file,
      line: startPosition.line,
      column: startPosition.column,
      endLine: endPosition.line,
      endColumn: endPosition.column,
      start: at.start,
      end,
    }
  }

  report(code: CompileDiagnosticCode, message: string, at: Range, extras: ReportExtras = {}): void {
    const span = this.span(at)
    const lines = this.indexes.get(at.file)?.lines ?? ['']
    const severity = severityOf(code)
    if (severity === 'error') this.errorCount++
    const diagnostic = {
      code,
      severity,
      message,
      span,
      frame: codeFrame(lines, span),
      ...(extras.hint !== undefined && { hint: extras.hint }),
      ...(extras.blockKey !== undefined && { blockKey: extras.blockKey }),
      ...(extras.param !== undefined && { param: extras.param }),
      ...(extras.related && {
        related: extras.related.map((entry) => ({
          span: this.span(entry.at),
          message: entry.message,
        })),
      }),
    } as LocatedDiagnostic<CompileDiagnosticCode>
    this.diagnostics.push(diagnostic)
  }
}
