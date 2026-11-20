import { truncateAtCodePoint } from '@sim/utils/string'
import { type CompileDiagnosticCode, framesSource, MAX_ERRORS } from '../diagnostics/codes'
import {
  codeFrame,
  LINE_BREAK,
  type LocatedDiagnostic,
  type SourceSpan,
  splitLines,
} from '../diagnostics/frame'
import { REFUSABLE_WARNING_CODES } from '../diagnostics/refusals'
import { severityOf } from '../diagnostics/severity'
import type { BlockKey, SubBlockId } from '../model'

/** Babel's line terminators, so lines agree with Babel `loc`. */
const LINE_BREAKS = new RegExp(LINE_BREAK.source, 'g')

/** Line start offsets of one file, for offset → line/column. */
export class LineIndex {
  private readonly starts: number[] = [0]
  private split: string[] | null = null

  constructor(readonly text: string) {
    for (const match of text.matchAll(LINE_BREAKS)) {
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
  /**
   * A function is called only when the diagnostic is recorded, so a costly did-you-mean is never
   * computed for a warning past {@link MAX_WARNINGS}; a withheld warning computes it when its
   * `hint` is first read.
   */
  hint?: string | (() => string | undefined)
  blockKey?: BlockKey
  param?: SubBlockId
  related?: Array<{ at: Range; message: string }>
}

/** Warnings one compile lists before the rest are omitted with `W_TOO_MANY_WARNINGS`. */
export const MAX_WARNINGS = 100
/**
 * Warnings of one code one compile lists before the rest of that code are omitted with
 * `W_TOO_MANY_WARNINGS`, so a flood of one finding leaves room under {@link MAX_WARNINGS} for the
 * others.
 */
export const MAX_WARNINGS_PER_CODE = 20
/** Infos one compile lists before the rest are dropped; counted apart so none displaces a warning. */
export const MAX_INFOS = 100
/** Code units of a message or hint kept; longer text, which quotes the source, is cut. */
const MAX_MESSAGE_LENGTH = 1_000

/**
 * Thrown by {@link Reporter.report} once {@link MAX_ERRORS} errors are listed, after it records
 * `E_TOO_MANY_ERRORS`. `compileWorkflow` catches it and returns no workflow, so a file of errors
 * costs no more work than its first hundred.
 */
export class ErrorLimitReached extends Error {
  constructor() {
    super(`More than ${MAX_ERRORS} errors.`)
    this.name = 'ErrorLimitReached'
  }
}

function capLength(text: string): string {
  return truncateAtCodePoint(text, MAX_MESSAGE_LENGTH, '…')
}

/**
 * Collects located diagnostics for every file a compile reads. Each diagnostic gets its span (from
 * offsets) and code frame here, so no other module computes line numbers. Output is bounded: at
 * most {@link MAX_ERRORS} errors, {@link MAX_WARNINGS} warnings and {@link MAX_INFOS} infos, each with a bounded frame and
 * message.
 */
export class Reporter {
  readonly diagnostics: LocatedDiagnostic<CompileDiagnosticCode>[] = []
  /**
   * The first of each {@link REFUSABLE_WARNING_CODES} code, block and file a warning cap left out
   * of {@link diagnostics}, so an apply's refusals are decided on every finding (see
   * `refuseEditedFindings`) while the listing stays capped.
   */
  readonly withheld: LocatedDiagnostic<CompileDiagnosticCode>[] = []
  /** The code, block and file of each refusable warning listed or withheld. */
  private readonly refusableHeld = new Set<string>()
  private readonly indexes = new Map<string, LineIndex>()
  private errorCount = 0
  private warningCount = 0
  private infoCount = 0
  private readonly warningsByCode = new Map<CompileDiagnosticCode, number>()
  /** What each recorded finding says where, so the same finding is listed once. */
  private readonly seen = new Set<string>()

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

  /**
   * Records a diagnostic, once: a finding with the same code, message and range as one already
   * recorded is dropped. The error after the {@link MAX_ERRORS}th is recorded as
   * `E_TOO_MANY_ERRORS` and throws {@link ErrorLimitReached}; the warning after the
   * {@link MAX_WARNINGS}th, or after the {@link MAX_WARNINGS_PER_CODE}th of its code, is recorded as
   * `W_TOO_MANY_WARNINGS` and later ones are dropped. Each severity has its own cap, so a warning
   * never crowds out an error, nor an info a warning.
   */
  report(code: CompileDiagnosticCode, message: string, at: Range, extras: ReportExtras = {}): void {
    const key = `${code}\u0000${at.file}\u0000${at.start}\u0000${at.end}\u0000${message}`
    if (this.seen.has(key)) return
    this.seen.add(key)
    const severity = severityOf(code)
    if (severity === 'error') {
      if (this.errorCount === MAX_ERRORS) {
        this.record(
          'E_TOO_MANY_ERRORS',
          `Stopped after ${MAX_ERRORS} errors. The next: ${message}`,
          at,
          { hint: 'Fix the errors listed and compile again to see the rest.' },
          framesSource(code)
        )
        throw new ErrorLimitReached()
      }
    } else if (severity === 'info') {
      if (this.infoCount >= MAX_INFOS) return
    } else if (this.warningCount >= MAX_WARNINGS) {
      this.withhold(code, message, at, extras)
      if (this.warningCount === MAX_WARNINGS) {
        this.record(
          'W_TOO_MANY_WARNINGS',
          `Listed ${MAX_WARNINGS} warnings; the rest are omitted. The next: ${message}`,
          at,
          {},
          framesSource(code)
        )
      }
      return
    } else {
      const ofCode = this.warningsByCode.get(code) ?? 0
      this.warningsByCode.set(code, ofCode + 1)
      if (ofCode >= MAX_WARNINGS_PER_CODE) {
        this.withhold(code, message, at, extras)
        if (ofCode === MAX_WARNINGS_PER_CODE) {
          this.record(
            'W_TOO_MANY_WARNINGS',
            `Listed ${MAX_WARNINGS_PER_CODE} ${code} warnings; the rest of them are omitted. The next: ${message}`,
            at,
            {},
            framesSource(code)
          )
        }
        return
      }
    }
    const held = refusableKey(code, at, extras)
    if (held !== undefined) this.refusableHeld.add(held)
    this.record(code, message, at, extras, framesSource(code))
  }

  /**
   * Keeps a refusable warning a cap left out in {@link withheld}, unless one of its code, block
   * and file is already listed or withheld.
   */
  private withhold(
    code: CompileDiagnosticCode,
    message: string,
    at: Range,
    extras: ReportExtras
  ): void {
    const held = refusableKey(code, at, extras)
    if (held === undefined || this.refusableHeld.has(held)) return
    this.refusableHeld.add(held)
    const { hint, ...listed } = extras
    const diagnostic = this.build(code, message, at, listed, framesSource(code))
    if (hint !== undefined) {
      let resolved: { hint: string | undefined } | undefined
      Object.defineProperty(diagnostic, 'hint', {
        enumerable: true,
        configurable: true,
        get: () => {
          if (!resolved) {
            const text = typeof hint === 'function' ? hint() : hint
            resolved = { hint: text === undefined ? undefined : capLength(text) }
          }
          return resolved.hint
        },
      })
    }
    this.withheld.push(diagnostic)
  }

  /** Records one diagnostic; `framed` is false when the finding at `at` is about a literal secret. */
  private record(
    code: CompileDiagnosticCode,
    message: string,
    at: Range,
    extras: ReportExtras,
    framed: boolean
  ): void {
    const severity = severityOf(code)
    if (severity === 'error') this.errorCount++
    else if (severity === 'info') this.infoCount++
    else this.warningCount++
    this.diagnostics.push(this.build(code, message, at, extras, framed))
  }

  private build(
    code: CompileDiagnosticCode,
    message: string,
    at: Range,
    extras: ReportExtras,
    framed: boolean
  ): LocatedDiagnostic<CompileDiagnosticCode> {
    const span = this.span(at)
    const lines = this.indexes.get(at.file)?.lines ?? ['']
    const severity = severityOf(code)
    const hint = typeof extras.hint === 'function' ? extras.hint() : extras.hint
    return {
      code,
      severity,
      message: capLength(message),
      span,
      ...(framed && { frame: codeFrame(lines, span) }),
      ...(hint !== undefined && { hint: capLength(hint) }),
      ...(extras.blockKey !== undefined && { blockKey: extras.blockKey }),
      ...(extras.param !== undefined && { param: extras.param }),
      ...(extras.related && {
        related: extras.related.map((entry) => ({
          span: this.span(entry.at),
          message: entry.message,
        })),
      }),
    } as LocatedDiagnostic<CompileDiagnosticCode>
  }
}

/** The code, block and file a refusable warning is withheld by; none for any other finding. */
function refusableKey(
  code: CompileDiagnosticCode,
  at: Range,
  extras: ReportExtras
): string | undefined {
  if (!REFUSABLE_WARNING_CODES.has(code) || extras.blockKey === undefined) return undefined
  return `${code}\u0000${extras.blockKey}\u0000${at.file}`
}
