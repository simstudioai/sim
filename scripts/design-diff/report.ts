import { createHash } from 'node:crypto'
import type { Change, Data, Report } from '#design-diff/types'

export const VALUE_PREVIEW_BYTES = 4096
export const REPORT_BYTES = 5 * 1024 * 1024

/** Hash the complete value; previews never participate in semantic comparison. */
export function previewValue(value: Data, limit = VALUE_PREVIEW_BYTES): Data {
  const json = JSON.stringify(value)
  const bytes = Buffer.byteLength(json)
  if (bytes <= limit) return value
  const buffer = Buffer.from(json)
  let end = Math.min(limit, buffer.length)
  while (end && (buffer[end] & 0xc0) === 0x80) end--
  return {
    $truncated: true,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    originalBytes: bytes,
    previewBytes: end,
    omittedBytes: bytes - end,
    preview: buffer.subarray(0, end).toString('utf8'),
  }
}

/** Decisions and IDs already exist when report detail is shortened. */
export function previewChange(change: Change): Change {
  const side = (value: Change['before']) =>
    value && {
      ...value,
      value: previewValue(value.value),
      conditions: value.conditions.map((value) => previewValue(value)),
    }
  return { ...change, before: side(change.before), after: side(change.after) }
}

/** Deterministic detail sampling with explicit totals; the overall decision is retained. */
export function serializeReport(report: Report, limit = REPORT_BYTES): string {
  if (limit < 4096) throw new Error('Report limit must leave room for report metadata')
  const copy: Report = structuredClone(report)
  const lists: { path: string; total: number; omitted: number }[] = []
  const sample = <T>(items: T[], path: string, count: number): T[] => {
    if (items.length > count)
      lists.push({ path, total: items.length, omitted: items.length - count })
    return items.slice(0, count)
  }
  const detail = (change: Change, path: string): Change => ({
    ...change,
    consumers: sample(change.consumers, `${path}.consumers`, 100),
    dependencies: sample(change.dependencies, `${path}.dependencies`, 100),
    limitations: sample(change.limitations, `${path}.limitations`, 100),
    before: change.before && {
      ...change.before,
      conditions: sample(change.before.conditions, `${path}.before.conditions`, 100),
    },
    after: change.after && {
      ...change.after,
      conditions: sample(change.after.conditions, `${path}.after.conditions`, 100),
    },
  })
  copy.findings = copy.findings.map((finding, index) => {
    const path = `findings[${index}]`
    const result = {
      ...finding,
      ...detail(finding, path),
      changes: sample(finding.changes, `${path}.changes`, 100).map((change, index) =>
        detail(change, `${path}.changes[${index}]`)
      ),
    }
    if (result.example)
      result.example.change = detail(result.example.change, `${path}.example.change`)
    for (const side of ['before', 'after'] as const)
      result.impact[side].references = sample(
        result.impact[side].references,
        `${path}.impact.${side}.references`,
        100
      )
    return result
  })
  copy.truncation = {
    valuePreviewBytes: VALUE_PREVIEW_BYTES,
    reportLimitBytes: limit,
    findingsTotal: report.findings.length,
    omittedFindings: 0,
    lists,
  }
  const json = () => `${JSON.stringify(copy, null, 2)}\n`
  let result = json()
  /** Remove details first, then source groups. Stable prefixes make repeated output identical. */
  if (Buffer.byteLength(result) > limit) {
    for (const [i, finding] of copy.findings.entries()) {
      finding.changes = sample(finding.changes, `findings[${i}].changes.remaining`, 1)
      for (const side of ['before', 'after'] as const)
        finding.impact[side].references = sample(
          finding.impact[side].references,
          `findings[${i}].impact.${side}.references.remaining`,
          1
        )
    }
    result = json()
  }
  if (Buffer.byteLength(result) > limit) {
    const candidates = copy.findings
    let low = 0
    let high = candidates.length
    while (low < high) {
      const count = Math.ceil((low + high) / 2)
      copy.findings = candidates.slice(0, count)
      copy.truncation.omittedFindings = report.findings.length - count
      if (Buffer.byteLength(json()) <= limit) low = count
      else high = count - 1
    }
    copy.findings = candidates.slice(0, low)
    copy.truncation.omittedFindings = report.findings.length - low
    result = json()
  }
  if (Buffer.byteLength(result) > limit) {
    copy.truncation.lists = []
    copy.limitations = [
      'Report detail exceeded the output budget; decisions were computed before truncation',
    ]
    result = json()
  }
  if (Buffer.byteLength(result) > limit) throw new Error('Report metadata exceeds output budget')
  return result
}
