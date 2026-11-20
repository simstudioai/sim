/**
 * How many findings one answer lists, and how long their text runs: bounded once, where findings
 * leave the process (a route's answer, a CLI command's output), never per stage, so a flood from
 * any stage (compile, canonicalize, print, materialize, lint) is capped the same way and a list
 * merged from several stages is capped as a whole. A cut list ends in one `I_FINDINGS_TRUNCATED`.
 *
 * A limit that stops work stays where the work is (the compile's `E_TOO_MANY_ERRORS`, its warning
 * caps that spare hint and frame work, a declaration reader's per-file stop); this module only
 * trims lists that already exist.
 */
import { truncateAtCodePoint } from '@sim/utils/string'
import { diagnostic } from './factory'
import type { DiagnosticSeverity } from './severity'

/** The limits {@link boundDiagnostics} applies. */
export interface FindingLimits {
  /** Findings of one severity. */
  perSeverity: number
  /** Warnings of one code, so a flood of one finding leaves room for the others. */
  warningsPerCode: number
  /** Findings in all, kept errors first, then warnings, then infos. */
  total: number
  /** Code units of a message or hint; longer text, which can quote the source, is cut. */
  textLength: number
}

/** The default limits: what one compile lists. */
export const FINDING_LIMITS: Readonly<FindingLimits> = {
  perSeverity: 100,
  warningsPerCode: 20,
  total: Number.POSITIVE_INFINITY,
  textLength: 1_000,
}

/** The fields {@link boundDiagnostics} reads. */
interface BoundedFinding {
  code: string
  severity: DiagnosticSeverity
  message: string
  hint?: string
}

/** What a bound left out of a list, by severity, with the length of the list it cut. */
export interface DroppedFindings {
  total: number
  error: number
  warning: number
  info: number
}

/** How {@link boundDiagnostics} cuts one list. */
export interface BoundOptions<D, M> {
  /** The `I_FINDINGS_TRUNCATED` finding that ends a cut list, given what was left out. */
  marker: (dropped: DroppedFindings) => M
  /** Limits beside the defaults ({@link FINDING_LIMITS}). */
  limits?: Partial<FindingLimits>
  /**
   * Errors kept ahead of the others when errors are cut, such as the codes that class a refusal
   * (stale, locked, too large), so a cut list still shows why the refusal is classed as it is.
   */
  first?: (finding: D) => boolean
}

const SEVERITY_RANK: Readonly<Record<DiagnosticSeverity, number>> = {
  error: 0,
  warning: 1,
  info: 2,
}

/** `finding` with its message and hint cut to `textLength` code units; itself when both fit. */
export function boundFindingText<D extends BoundedFinding>(
  finding: D,
  textLength: number = FINDING_LIMITS.textLength
): D {
  const { message, hint } = finding
  if (message.length <= textLength && (hint === undefined || hint.length <= textLength)) {
    return finding
  }
  return {
    ...finding,
    message: truncateAtCodePoint(message, textLength, '…'),
    ...(hint !== undefined ? { hint: truncateAtCodePoint(hint, textLength, '…') } : {}),
  }
}

/**
 * `list` within the limits, in its own order, each finding's text cut (see
 * {@link boundFindingText}). Which findings stay: per severity the first ones, errors before
 * warnings before infos when `total` cuts (and among errors `first` before the rest), and at most
 * `warningsPerCode` warnings of one code. When any is left out the list ends in `marker` of what
 * was; a marker is an info, so cutting a list never refuses it nor changes how it is classed.
 */
export function boundDiagnostics<D extends BoundedFinding, M extends BoundedFinding>(
  list: readonly D[],
  options: BoundOptions<D, M>
): Array<D | M> {
  const limits = { ...FINDING_LIMITS, ...options.limits }
  const rank = (finding: D) =>
    SEVERITY_RANK[finding.severity] * 2 +
    (finding.severity === 'error' && !(options.first?.(finding) ?? false) ? 1 : 0)
  const order = list
    .map((finding, index) => ({ finding, index }))
    .sort((a, b) => rank(a.finding) - rank(b.finding) || a.index - b.index)

  const kept = new Set<number>()
  const bySeverity: Record<DiagnosticSeverity, number> = { error: 0, warning: 0, info: 0 }
  const warningsByCode = new Map<string, number>()
  const dropped: DroppedFindings = { total: list.length, error: 0, warning: 0, info: 0 }
  for (const { finding, index } of order) {
    const ofCode = finding.severity === 'warning' ? (warningsByCode.get(finding.code) ?? 0) : 0
    if (
      kept.size >= limits.total ||
      bySeverity[finding.severity] >= limits.perSeverity ||
      ofCode >= limits.warningsPerCode
    ) {
      dropped[finding.severity]++
      continue
    }
    kept.add(index)
    bySeverity[finding.severity]++
    if (finding.severity === 'warning') warningsByCode.set(finding.code, ofCode + 1)
  }

  const listed: Array<D | M> = list.flatMap((finding, index) =>
    kept.has(index) ? [boundFindingText(finding, limits.textLength)] : []
  )
  if (kept.size === list.length) return listed
  return [...listed, boundFindingText(options.marker(dropped), limits.textLength)]
}

/**
 * The `I_FINDINGS_TRUNCATED` that ends a cut list of workflow source findings, counting what it
 * left out.
 */
export function findingsTruncated(dropped: DroppedFindings) {
  const left = dropped.error + dropped.warning + dropped.info
  return diagnostic(
    'I_FINDINGS_TRUNCATED',
    `There are ${dropped.total} findings; ${left} more${dropped.error > 0 ? ` (${dropped.error} of them errors)` : ''} are left out.`,
    { hint: 'Fix the findings shown, then check again to see the rest.' }
  )
}
