export const INTERNAL_USAGE_LOG_SOURCES = [
  'workflow',
  'wand',
  'copilot',
  'workspace-chat',
  'mcp_copilot',
  'mothership_block',
  'knowledge-base',
  'voice-input',
  'enrichment',
  'voice-output',
] as const

export type InternalUsageLogSource = (typeof INTERNAL_USAGE_LOG_SOURCES)[number]

export const INTERNAL_CHAT_BILLING_SOURCES = [
  'copilot',
  'workspace-chat',
  'mcp_copilot',
  'mothership_block',
] as const satisfies readonly InternalUsageLogSource[]

export const BILLING_USAGE_LOG_SOURCES = [
  'workflow',
  'wand',
  'sim-chat',
  'mcp_copilot',
  'mothership_block',
  'knowledge-base',
  'voice-input',
  'enrichment',
  'voice-output',
] as const

export type BillingUsageLogSource = (typeof BILLING_USAGE_LOG_SOURCES)[number]

const INTERNAL_TO_BILLING_SOURCE = {
  workflow: 'workflow',
  wand: 'wand',
  copilot: 'sim-chat',
  'workspace-chat': 'sim-chat',
  mcp_copilot: 'mcp_copilot',
  mothership_block: 'mothership_block',
  'knowledge-base': 'knowledge-base',
  'voice-input': 'voice-input',
  enrichment: 'enrichment',
  'voice-output': 'voice-output',
} as const satisfies Record<InternalUsageLogSource, BillingUsageLogSource>

const INTERNAL_USAGE_LOG_SOURCE_SET = new Set<string>(INTERNAL_USAGE_LOG_SOURCES)

const BILLING_TO_INTERNAL_SOURCES = {
  workflow: ['workflow'],
  wand: ['wand'],
  'sim-chat': ['copilot', 'workspace-chat'],
  mcp_copilot: ['mcp_copilot'],
  mothership_block: ['mothership_block'],
  'knowledge-base': ['knowledge-base'],
  'voice-input': ['voice-input'],
  enrichment: ['enrichment'],
  'voice-output': ['voice-output'],
} as const satisfies Record<BillingUsageLogSource, readonly InternalUsageLogSource[]>

export const BILLING_USAGE_LOG_SOURCE_LABELS = {
  workflow: 'Workflow',
  wand: 'Wand',
  'sim-chat': 'Sim Chat',
  mcp_copilot: 'Sim Chat (MCP)',
  mothership_block: 'Agent block',
  'knowledge-base': 'Knowledge Base',
  'voice-input': 'Voice input',
  enrichment: 'Enrichment',
  'voice-output': 'Voice output',
} as const satisfies Record<BillingUsageLogSource, string>

export function toBillingUsageLogSource(source: InternalUsageLogSource): BillingUsageLogSource {
  if (!Object.hasOwn(INTERNAL_TO_BILLING_SOURCE, source)) {
    throw new Error(`Unknown internal usage log source: ${source}`)
  }
  return INTERNAL_TO_BILLING_SOURCE[source]
}

export function toInternalUsageLogSources(source: BillingUsageLogSource): InternalUsageLogSource[] {
  if (!Object.hasOwn(BILLING_TO_INTERNAL_SOURCES, source)) {
    throw new Error(`Unknown billing usage log source: ${source}`)
  }
  return [...BILLING_TO_INTERNAL_SOURCES[source]]
}

export function aggregateBillingUsageBySource(
  usageBySource: Partial<Record<InternalUsageLogSource, number>>
): Partial<Record<BillingUsageLogSource, number>> {
  const unknownSource = Object.keys(usageBySource).find(
    (source) => !INTERNAL_USAGE_LOG_SOURCE_SET.has(source)
  )
  if (unknownSource) throw new Error(`Unknown internal usage log source: ${unknownSource}`)

  const billingUsage: Partial<Record<BillingUsageLogSource, number>> = {}

  for (const internalSource of INTERNAL_USAGE_LOG_SOURCES) {
    const value = usageBySource[internalSource]
    if (value === undefined) continue

    const billingSource = toBillingUsageLogSource(internalSource)
    billingUsage[billingSource] = (billingUsage[billingSource] ?? 0) + value
  }

  return billingUsage
}
