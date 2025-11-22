import { getBlock } from '@/blocks/registry'
import { getAllTriggers } from '@/triggers'

export interface TriggerOption {
  value: string
  label: string
  color: string
}

/**
 * Dynamically generates trigger filter options from the trigger registry and block definitions.
 */
export function getTriggerOptions(): TriggerOption[] {
  const triggers = getAllTriggers()
  const providerMap = new Map<string, TriggerOption>()

  const coreTypes: TriggerOption[] = [
    { value: 'manual', label: 'Manual', color: '#6b7280' }, // gray-500
    { value: 'api', label: 'API', color: '#3b82f6' }, // blue-500
    { value: 'schedule', label: 'Schedule', color: '#10b981' }, // green-500
    { value: 'chat', label: 'Chat', color: '#8b5cf6' }, // purple-500
    { value: 'webhook', label: 'Webhook', color: '#f97316' }, // orange-500 (for backward compatibility)
  ]

  for (const trigger of triggers) {
    const provider = trigger.provider

    if (!provider || providerMap.has(provider)) {
      continue
    }

    const block = getBlock(provider)

    if (block) {
      providerMap.set(provider, {
        value: provider,
        label: block.name, // Use block's display name (e.g., "Slack", "GitHub")
        color: block.bgColor || '#6b7280', // Use block's hex color, fallback to gray
      })
    } else {
      const label = formatProviderName(provider)
      providerMap.set(provider, {
        value: provider,
        label,
        color: '#6b7280', // gray fallback
      })
    }
  }

  const integrationOptions = Array.from(providerMap.values()).sort((a, b) =>
    a.label.localeCompare(b.label)
  )

  return [...coreTypes, ...integrationOptions]
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
 * Gets integration metadata (label and color) for a specific trigger type.
 * Falls back to auto-formatting if not found in the registry.
 */
export function getIntegrationMetadata(triggerType: string): { label: string; color: string } {
  const options = getTriggerOptions()
  const found = options.find((opt) => opt.value === triggerType)

  if (found) {
    return { label: found.label, color: found.color }
  }

  return {
    label: formatProviderName(triggerType),
    color: '#6b7280', // gray
  }
}
