import type { SubBlockConfig } from '@/blocks/types'
import { WEBHOOK_PROVIDERS } from './constants'

/**
 * Gets the display name for a webhook provider
 *
 * @param providerId - The provider identifier
 * @returns The human-readable provider name
 */
export function getProviderName(providerId: string): string {
  return WEBHOOK_PROVIDERS[providerId] || 'Webhook'
}

/**
 * Creates a debounced version of a function
 *
 * @param func - The function to debounce
 * @param wait - The delay in milliseconds
 * @returns The debounced function
 */
export function debounce<T extends (...args: any[]) => void>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout
  return (...args: Parameters<T>) => {
    clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }
}

/**
 * Generates a stable key for a subblock that accounts for dynamic state changes
 * This is especially important for MCP blocks where server/tool selection affects rendering
 *
 * @param blockId - The parent block ID
 * @param subBlock - The subblock configuration
 * @param stateToUse - The current state values for the block
 * @returns A stable key string for React reconciliation
 */
export function getSubBlockStableKey(
  blockId: string,
  subBlock: SubBlockConfig,
  stateToUse: Record<string, any>
): string {
  if (subBlock.type === 'mcp-dynamic-args') {
    const serverValue = stateToUse.server?.value || 'no-server'
    const toolValue = stateToUse.tool?.value || 'no-tool'
    return `${blockId}-${subBlock.id}-${serverValue}-${toolValue}`
  }

  if (subBlock.type === 'mcp-tool-selector') {
    const serverValue = stateToUse.server?.value || 'no-server'
    return `${blockId}-${subBlock.id}-${serverValue}`
  }

  return `${blockId}-${subBlock.id}`
}
