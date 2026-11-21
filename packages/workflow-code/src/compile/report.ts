import { truncateAtCodePoint } from '@sim/utils/string'
import { FINDING_LIMITS } from '../diagnostics/bound'
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
   * computed for a warning past {@link MAX_LISTED}; a withheld warning computes it when its
   * `hint` is first read.
   */
  hint?: string | (() => string | undefined)
  blockKey?: BlockKey
  param?: SubBlockId
  related?: Array<{ at: Range; message: string }>
}

/**
 * How many warnings and infos one compile builds, and how long their text runs: the defaults of
 * the bound every answer applies (`FINDING_LIMITS`). These stop work, not only trim a list: a
 * warning past them computes no did-you-mean unless read, and no code frame unless it is a
 * refusable one kept back (one per code, block and file); a message never holds more of the
 * source it quotes than an answer could show.
 */
const {
  perSeverity: MAX_LISTED,
  warningsPerCode: MAX_WARNINGS_PER_CODE,
  textLength,
} = FINDING_LIMITS

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
  return truncateAtCodePoint(text, textLength, '…')
}

/**
 * Collects located diagnostics for every file a compile reads. Each diagnostic gets its span (from
 * offsets) and code frame here, so no other module computes line numbers. The work is bounded: at
 * most {@link MAX_ERRORS} errors, and {@link MAX_LISTED} warnings and as many infos, each with a
 * bounded frame and message.
 */
export class Reporter {
  readonly diagnostics: LocatedDiagnostic<CompileDiagnosticCode>[] = []
  /**
   * The first of each {@link REFUSABLE_WARNING_CODES} code, block and file a warning cap left out
   * of {@link diagnostics}, so an apply's refusals are decided on every finding (see
   * `refuseEditedFindings`) while the listing stays capped.
   */
  readonly withheld: LocatedDiagnostic<CompileDiagnosticCode>[] = []
  /**
   * Every other warning a cap left out, counted by code and block, and a refusable one also by
   * file and field (no text, span or frame is built for one), so a caller can still count and
   * judge every finding while what is kept stays bounded by the blocks, files and fields read.
   */
  get omitted(): OmittedFinding[] {
    return [...this.omittedCounts.values()]
  }
  private readonly omittedCounts = new Map<string, OmittedFinding>()
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
   * `E_TOO_MANY_ERRORS` and throws {@link ErrorLimitReached}; where the warning after the
   * {@link MAX_LISTED}th, or after the {@link MAX_WARNINGS_PER_CODE}th of its code, was found one
   * `I_FINDINGS_TRUNCATED` is recorded (taking that warning's place in the count) and later ones
   * are dropped. Each severity has its own cap, so a warning never crowds out an error, nor an
   * info a warning.
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
      if (this.infoCount >= MAX_LISTED) return
    } else if (this.warningCount >= MAX_LISTED) {
      this.omit(code, message, at, extras)
      if (this.warningCount === MAX_LISTED) {
        this.truncated(
          `Listed ${MAX_LISTED} warnings; the rest are omitted. The next: ${message}`,
          at,
          framesSource(code)
        )
      }
      return
    } else {
      const ofCode = this.warningsByCode.get(code) ?? 0
      this.warningsByCode.set(code, ofCode + 1)
      if (ofCode >= MAX_WARNINGS_PER_CODE) {
        this.omit(code, message, at, extras)
        if (ofCode === MAX_WARNINGS_PER_CODE) {
          this.truncated(
            `Listed ${MAX_WARNINGS_PER_CODE} ${code} warnings; the rest of them are omitted. The next: ${message}`,
            at,
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
   * Keeps a warning a cap left out: in {@link withheld} when it is refusable and none of its code,
   * block and file is listed or withheld yet, else in {@link omitted}.
   */
  private omit(
    code: CompileDiagnosticCode,
    message: string,
    at: Range,
    extras: ReportExtras
  ): void {
    const held = refusableKey(code, at, extras)
    if (held === undefined || this.refusableHeld.has(held)) {
      // A refusable warning keeps its file and field, which decide whether an apply refuses it.
      const refusable = held === undefined ? undefined : { file: at.file, param: extras.param }
      const key = [code, extras.blockKey ?? '', refusable?.file ?? '', refusable?.param ?? ''].join(
        '\u0000'
      )
      const counted = this.omittedCounts.get(key)
      if (counted) counted.count++
      else {
        this.omittedCounts.set(key, {
          code,
          ...(extras.blockKey !== undefined ? { blockKey: extras.blockKey } : {}),
          ...(refusable ? { file: refusable.file } : {}),
          ...(refusable?.param !== undefined ? { param: refusable.param } : {}),
          count: 1,
        })
      }
      return
    }
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

  /**
   * Records the `I_FINDINGS_TRUNCATED` that stands where a warning cap left a warning out. It
   * takes that warning's place in the warning count, so the caps list as many findings as when
   * the marker was a warning.
   */
  private truncated(message: string, at: Range, framed: boolean): void {
    this.warningCount++
    this.diagnostics.push(this.build('I_FINDINGS_TRUNCATED', message, at, {}, framed))
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

/**
 * The warnings of one code and block a compile's caps left out of every list
 * ({@link Reporter.omitted}). A {@link REFUSABLE_WARNING_CODES} warning is counted per file and
 * field too, which decide whether an apply refuses it.
 */
export interface OmittedFinding {
  code: CompileDiagnosticCode
  blockKey?: BlockKey
  /** The file a refusable warning is in. */
  file?: string
  /** The field a refusable warning names. */
  param?: SubBlockId
  /** How many warnings of this code, block (and, when refusable, file and field) were left out. */
  count: number
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
