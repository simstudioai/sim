import { getBlock } from '@/blocks'

const PROVIDER_CONFIGURATION_IDS = new Set([
  'operation',
  'fields',
  'cursor',
  'credential',
  'oauthCredential',
  'manualCredential',
  'selectedTriggerId',
  'triggerCredentials',
])

function readSubBlockValue(value: unknown): unknown {
  return value && typeof value === 'object' && 'value' in value
    ? (value as { value: unknown }).value
    : value
}

function referencesInput(value: unknown, fieldName: string): boolean {
  if (typeof value === 'string') {
    const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`<[^>]+\\.${escaped}(?:\\.[^>]*)?>`, 'i').test(value)
  }
  if (Array.isArray(value)) return value.some((entry) => referencesInput(entry, fieldName))
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((entry) =>
      referencesInput(entry, fieldName)
    )
  }
  return false
}

/**
 * Public App inputs must represent user intent, not raw provider configuration.
 * Reject start fields wired into operation/field-selection/OAuth internals.
 */
export function assertAppInputBoundary(params: {
  startBlockId: string
  fieldNames: string[]
  blocks: Record<
    string,
    {
      id?: string
      type: string
      subBlocks?: Record<string, unknown>
    }
  >
}): { ok: true } | { ok: false; error: string; code: string } {
  for (const [blockId, block] of Object.entries(params.blocks)) {
    if (blockId === params.startBlockId || block.id === params.startBlockId) continue
    const config = getBlock(block.type)

    for (const [subBlockId, rawValue] of Object.entries(block.subBlocks || {})) {
      const subBlockConfig = config?.subBlocks?.find((subBlock) => subBlock.id === subBlockId)
      const isProviderConfig =
        PROVIDER_CONFIGURATION_IDS.has(subBlockId) ||
        subBlockConfig?.type === 'oauth-input' ||
        subBlockId.toLowerCase().includes('credential')
      if (!isProviderConfig) continue

      const value = readSubBlockValue(rawValue)
      for (const fieldName of params.fieldNames) {
        if (!referencesInput(value, fieldName)) continue
        return {
          ok: false,
          error: `API start field "${fieldName}" is wired to internal ${block.type}.${subBlockId} provider configuration and cannot be exposed to an App`,
          code: 'PROVIDER_CONFIG_INPUT_EXPOSED',
        }
      }
    }
  }
  return { ok: true }
}
