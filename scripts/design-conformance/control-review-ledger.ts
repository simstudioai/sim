import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import type { ReviewItem } from '#control-analysis/review'
import { canonical, type Finding, hash } from '#design-conformance/model'

export interface ReviewDecision {
  fingerprint: string
  status: 'retained-extra' | 'designer-review' | 'false-positive'
  rationale: string
  evidence: string
}
export interface ReviewLedger {
  version: '1.0.0'
  entries: ReviewDecision[]
}
export interface ReviewMatch extends ReviewDecision {
  kind: 'finding' | 'review-item'
  file: string
  line: number
}
export interface ReviewDecisions {
  matches: ReviewMatch[]
  stale: string[]
  ambiguous: string[]
}

/** Line-independent, exact styling identity. Duplicate candidates are deliberately ambiguous. */
export function findingFingerprint(finding: Finding): string {
  return hash(
    canonical([
      'finding',
      finding.file,
      finding.context,
      finding.rule,
      finding.property,
      finding.value,
    ])
  )
}
export function itemFingerprint(item: ReviewItem): string {
  return hash(canonical(['review-item', item.file, item.owner, item.kind, item.value]))
}
export function readReviewLedger(file: string, repo: string): ReviewLedger {
  const actual = realpathSync(file)
  const relative = path.relative(realpathSync(repo), actual)
  if (
    !relative ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  )
    throw new Error('Review ledger must be outside the audited product checkout')
  const data: unknown = JSON.parse(readFileSync(actual, 'utf8'))
  if (
    !data ||
    typeof data !== 'object' ||
    (data as ReviewLedger).version !== '1.0.0' ||
    !Array.isArray((data as ReviewLedger).entries)
  )
    throw new Error('Invalid review ledger')
  const entries = (data as ReviewLedger).entries
  if (
    entries.some(
      (entry) =>
        !/^[a-f\d]{64}$/.test(entry.fingerprint) ||
        !['retained-extra', 'designer-review', 'false-positive'].includes(entry.status) ||
        !entry.rationale?.trim() ||
        !entry.evidence?.trim()
    )
  )
    throw new Error('Review ledger entry lacks an exact fingerprint, status, rationale or evidence')
  if (new Set(entries.map((entry) => entry.fingerprint)).size !== entries.length)
    throw new Error('Duplicate review ledger fingerprint')
  return { version: '1.0.0', entries }
}
export function matchReviews(
  ledger: ReviewLedger,
  findings: Finding[],
  items: ReviewItem[]
): ReviewDecisions {
  const candidates = new Map<string, { kind: ReviewMatch['kind']; file: string; line: number }[]>()
  for (const finding of findings) {
    const fingerprint = findingFingerprint(finding)
    candidates.set(fingerprint, [
      ...(candidates.get(fingerprint) ?? []),
      { kind: 'finding', file: finding.file, line: finding.line },
    ])
  }
  for (const item of items) {
    const fingerprint = itemFingerprint(item)
    candidates.set(fingerprint, [
      ...(candidates.get(fingerprint) ?? []),
      { kind: 'review-item', file: item.file, line: item.line },
    ])
  }
  const result: ReviewDecisions = { matches: [], stale: [], ambiguous: [] }
  for (const entry of ledger.entries) {
    const matches = candidates.get(entry.fingerprint) ?? []
    if (!matches.length) result.stale.push(entry.fingerprint)
    else if (matches.length !== 1) result.ambiguous.push(entry.fingerprint)
    else result.matches.push({ ...entry, ...matches[0] })
  }
  return result
}
