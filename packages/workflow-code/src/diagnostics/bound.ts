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
import { type RefusalClass, refusalClass } from './refusals'
import type { DiagnosticSeverity } from './severity'

/** The limits {@link boundAnswerFindings} applies. */
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

/** The fields {@link boundAnswerFindings} reads. */
interface BoundedFinding {
  code: string
  severity: DiagnosticSeverity
  message: string
  hint?: string
}

/** What a bound left out of a list, by severity, beside how long the list was. */
interface DroppedFindings {
  /** Findings in the list, the `I_FINDINGS_TRUNCATED` it already carried aside. */
  total: number
  error: number
  warning: number
  info: number
  /** `I_FINDINGS_TRUNCATED` the list carried, where a stage stopped listing its own findings. */
  stopped: number
}

/** How one answer's findings are bounded. */
export interface AnswerBound {
  /** Limits beside the defaults ({@link FINDING_LIMITS}). */
  limits?: Partial<FindingLimits>
  /**
   * The vocabulary's refusal classifier: errors it classes (stale, locked, too large) are kept
   * ahead of the other errors when errors are cut, so a cut list still shows why the refusal is
   * classed as it is. The workflow vocabulary's by default.
   */
  classify?: (codes: Iterable<string>) => RefusalClass
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

/** The `I_FINDINGS_TRUNCATED` that ends a list one answer cut, counting what it left out. */
function findingsTruncated(dropped: DroppedFindings) {
  const left = dropped.error + dropped.warning + dropped.info
  const stopped =
    dropped.stopped > 0 ? ' Some checks also stopped listing their own findings early.' : ''
  return diagnostic(
    'I_FINDINGS_TRUNCATED',
    `There are ${dropped.total} findings; ${left} more${dropped.error > 0 ? ` (${dropped.error} of them errors)` : ''} are left out.${stopped}`,
    { hint: 'Fix the findings shown, then check again to see the rest.' }
  )
}

/** The `I_FINDINGS_TRUNCATED` a cut list ends in. */
type TruncationFinding = ReturnType<typeof findingsTruncated>

/**
 * `list` as one answer lists it: within the limits, in its own order, each finding's text cut
 * (see {@link boundFindingText}). Which findings stay: per severity the first ones, errors before
 * warnings before infos when `total` cuts (and among errors those `classify` classes before the
 * rest), and at most `warningsPerCode` warnings of one code. A list it cuts ends in one
 * `I_FINDINGS_TRUNCATED` counting what it left out, in place of any the list carried (where a
 * stage stopped listing), so a cut list never holds a second; a list it does not cut keeps those
 * as they are, one per stage that stopped. The marker is an info, so cutting a list never refuses it nor changes its class.
 */
export function boundAnswerFindings<D extends BoundedFinding>(
  list: readonly D[],
  bound: AnswerBound = {}
): Array<D | TruncationFinding> {
  const limits = { ...FINDING_LIMITS, ...bound.limits }
  const classify = bound.classify ?? refusalClass
  const rank = (finding: D) =>
    SEVERITY_RANK[finding.severity] * 2 +
    (finding.severity === 'error' && classify([finding.code]) === 'validation' ? 1 : 0)
  const order = list
    .map((finding, index) => ({ finding, index }))
    .filter(({ finding }) => finding.code !== 'I_FINDINGS_TRUNCATED')
    .sort((a, b) => rank(a.finding) - rank(b.finding) || a.index - b.index)

  const kept = new Set<number>()
  const bySeverity: Record<DiagnosticSeverity, number> = { error: 0, warning: 0, info: 0 }
  const warningsByCode = new Map<string, number>()
  const dropped: DroppedFindings = {
    total: order.length,
    error: 0,
    warning: 0,
    info: 0,
    stopped: list.length - order.length,
  }
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

  const bounded = (finding: D) => boundFindingText(finding, limits.textLength)
  if (kept.size === order.length) return list.map(bounded)
  const listed = list.flatMap((finding, index) => (kept.has(index) ? [bounded(finding)] : []))
  return [...listed, boundFindingText(findingsTruncated(dropped), limits.textLength)]
}
