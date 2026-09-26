import type { Finding } from '#design-conformance/model'

export interface LayoutAllowance {
  file: string
  line: number
  column: number
  context: string
  property: string
  value: string
  reason: string
}

/** Classify resolved declarations, never entire components or their unresolved inputs. */
export function classifyLayout<T extends Finding>(
  findings: T[]
): {
  findings: T[]
  allowances: LayoutAllowance[]
} {
  const allowances: LayoutAllowance[] = []
  const remaining = findings.filter((finding) => {
    if (
      finding.kind !== 'usage-violation' ||
      finding.rule !== 'component-chrome' ||
      finding.contract !== 'component-chrome' ||
      finding.provenance?.composition !== 'className' ||
      finding.provenance.input !== finding.value ||
      finding.reason.includes('forwarded')
    )
      return true

    /** Targets here are canonical symbols emitted by the source resolver, not JSX spellings. */
    const target = finding.context.match(
      /^[^/]+ \/ @sim\/emcn#(ChipModalField|ChipModal) \/ className$/
    )?.[1]
    let reason: string | undefined
    if (target === 'ChipModalField') {
      const layout: Record<string, string> = {
        'flex-1': 'flex',
        'shrink-0': 'flex-shrink',
        'min-h-0': 'min-height',
      }
      if (Object.hasOwn(layout, finding.value) && layout[finding.value] === finding.property)
        reason =
          'External field-wrapper growth/shrink constraint; internal field direction and chrome remain governed'
    } else if (target === 'ChipModal' && finding.property === 'height') {
      const height = finding.value.match(/^h-\[((?:\d+\.)?\d+)(?:d|s|l)?vh\]$/)
      if (height && Number(height[1]) > 0 && Number(height[1]) <= 100)
        reason =
          'Modal viewport height between 0 and 100vh; field/control heights and internal spacing remain governed'
    }
    if (!reason) return true
    const { file, line, column, context, property, value } = finding
    allowances.push({ file, line, column, context, property, value, reason })
    return false
  })
  return { findings: remaining, allowances }
}
