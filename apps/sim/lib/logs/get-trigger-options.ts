import { getLatestBlock } from '@/blocks/registry'
import { getAllTriggers } from '@/triggers'

export interface TriggerOption {
  value: string
  label: string
  color: string
}

let cachedTriggerOptions: TriggerOption[] | null = null
let cachedTriggerMetadataMap: Map<string, { label: string; color: string }> | null = null

/**
 * Reset cache - useful for HMR in development or testing
 */
export function resetTriggerOptionsCache() {
  cachedTriggerOptions = null
  cachedTriggerMetadataMap = null
}

/**
 * Dynamically generates trigger filter options from the trigger registry and block definitions.
 * Results are cached after first call for performance (~98% faster on subsequent calls).
 */
export function getTriggerOptions(): TriggerOption[] {
  if (cachedTriggerOptions) {
    return cachedTriggerOptions
  }

  const triggers = getAllTriggers()
  const providerMap = new Map<string, TriggerOption>()

  const coreTypes: TriggerOption[] = [
    { value: 'manual', label: 'Manual', color: '#6b7280' },
    { value: 'api', label: 'API', color: '#2563eb' },
    { value: 'schedule', label: 'Schedule', color: '#059669' },
    { value: 'chat', label: 'Chat', color: '#7c3aed' },
    { value: 'form', label: 'Form', color: '#06b6d4' },
    { value: 'webhook', label: 'Webhook', color: '#ea580c' },
    { value: 'mcp', label: 'MCP', color: '#dc2626' },
    { value: 'a2a', label: 'A2A', color: '#14b8a6' },
  ]

  for (const trigger of triggers) {
    const provider = trigger.provider

    // Skip generic webhook and already processed providers
    if (!provider || providerMap.has(provider) || provider === 'generic') {
      continue
    }

    const block = getLatestBlock(provider)

    providerMap.set(provider, {
      value: provider,
      label: block?.name || formatProviderName(provider),
      color: block?.bgColor || '#6b7280',
    })
  }

  const integrationOptions = Array.from(providerMap.values()).sort((a, b) =>
    a.label.localeCompare(b.label)
  )

  cachedTriggerOptions = [...coreTypes, ...integrationOptions]
  return cachedTriggerOptions
}

/**
 * Formats a provider name into a display-friendly label
 * e.g., "microsoft_teams" -> "Microsoft Teams"
 */
function formatProviderName(provider: string): string {
  return provider
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Internal: Initialize metadata map for O(1) lookups
 * Converts array of options to Map for fast access
 */
function initializeTriggerMetadataMap(): Map<string, { label: string; color: string }> {
  if (cachedTriggerMetadataMap) {
    return cachedTriggerMetadataMap
  }

  const options = getTriggerOptions()
  cachedTriggerMetadataMap = new Map(
    options.map((opt) => [opt.value, { label: opt.label, color: opt.color }])
  )

  return cachedTriggerMetadataMap
}

/**
 * Gets integration metadata (label and color) for a specific trigger type.
 */
export function getIntegrationMetadata(triggerType: string): { label: string; color: string } {
  const metadataMap = initializeTriggerMetadataMap()
  const found = metadataMap.get(triggerType)

  if (found) {
    return found
  }

  return {
    label: formatProviderName(triggerType),
    color: '#6b7280', // gray
  }
}
