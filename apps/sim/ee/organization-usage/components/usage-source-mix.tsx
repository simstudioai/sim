'use client'

import { ChartFrame, DonutChart } from '@sim/emcn'
import type { OrganizationUsageBreakdown } from '@/lib/api/contracts/organization-usage'

const SOURCE_COLORS: Readonly<Record<string, string>> = {
  workflow: 'var(--indicator-seat-filled)',
  'sim-chat': 'var(--brand-agent)',
  mcp_copilot: 'var(--badge-purple-text)',
  mothership_block: 'var(--badge-pink-text)',
  'knowledge-base': 'var(--badge-teal-text)',
  enrichment: 'var(--badge-amber-text)',
  wand: 'var(--badge-cyan-text)',
  'voice-input': 'var(--badge-orange-text)',
  'voice-output': 'var(--text-success)',
  'api-tool': 'var(--badge-blue-text)',
}
const MAX_SOURCES = 5

interface UsageSourceMixProps {
  breakdown?: OrganizationUsageBreakdown
  isLoading: boolean
  isError: boolean
}

export function UsageSourceMix({ breakdown, isLoading, isError }: UsageSourceMixProps) {
  const rows = breakdown?.rows ?? []
  const head = rows.slice(0, MAX_SOURCES)
  const tail = rows.slice(MAX_SOURCES)
  const otherCredits =
    tail.reduce((total, row) => total + row.credits, 0) + (breakdown?.other.credits ?? 0)
  const segments = [
    ...head.map((row) => ({
      label: row.label,
      value: row.credits,
      color: SOURCE_COLORS[row.id ?? ''] ?? 'var(--text-muted)',
    })),
    ...(otherCredits > 0 ? [{ label: 'Other', value: otherCredits, color: 'var(--border)' }] : []),
  ]

  return (
    <ChartFrame
      height={200}
      loading={isLoading || (!breakdown && !isError)}
      error={isError ? "Couldn't load sources." : undefined}
    >
      <DonutChart segments={segments} label='Credits by source' />
    </ChartFrame>
  )
}
