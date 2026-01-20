import type { ComponentType } from 'react'
import { getAllBlocks } from '@/blocks'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'

/**
 * Represents a searchable tool operation extracted from block configurations.
 * Each operation maps to a specific tool that can be invoked when the block
 * is configured with that operation selected.
 */
export interface ToolOperationItem {
  /** Unique identifier combining block type and operation ID (e.g., "slack_send") */
  id: string
  /** The block type this operation belongs to (e.g., "slack") */
  blockType: string
  /** The operation dropdown value (e.g., "send") */
  operationId: string
  /** Human-readable service name from the block (e.g., "Slack") */
  serviceName: string
  /** Human-readable operation name from the dropdown label (e.g., "Send Message") */
  operationName: string
  /** The block's icon component */
  icon: ComponentType<{ className?: string }>
  /** The block's background color */
  bgColor: string
  /** Search aliases for common synonyms */
  aliases: string[]
}

/**
 * Maps common action verbs to their synonyms for better search matching.
 * When a user searches for "post message", it should match "send message".
 * Based on analysis of 1000+ tool operations in the codebase.
 */
const ACTION_VERB_ALIASES: Record<string, string[]> = {
  get: ['read', 'fetch', 'retrieve', 'load', 'obtain'],
  read: ['get', 'fetch', 'retrieve', 'load'],
  create: ['make', 'new', 'add', 'generate', 'insert'],
  add: ['create', 'insert', 'append', 'include'],
  update: ['edit', 'modify', 'change', 'patch', 'set'],
  set: ['update', 'configure', 'assign'],
  delete: ['remove', 'trash', 'destroy', 'erase'],
  remove: ['delete', 'clear', 'drop', 'unset'],
  list: ['show', 'display', 'view', 'browse', 'enumerate'],
  search: ['find', 'query', 'lookup', 'locate'],
  query: ['search', 'find', 'lookup'],
  send: ['post', 'write', 'deliver', 'transmit', 'publish'],
  write: ['send', 'post', 'compose'],
  download: ['export', 'save', 'pull', 'fetch'],
  upload: ['import', 'push', 'transfer', 'attach'],
  execute: ['run', 'invoke', 'trigger', 'perform', 'start'],
  check: ['verify', 'validate', 'test', 'inspect'],
  cancel: ['abort', 'stop', 'terminate', 'revoke'],
  archive: ['store', 'backup', 'preserve'],
  copy: ['duplicate', 'clone', 'replicate'],
  move: ['transfer', 'relocate', 'migrate'],
  share: ['publish', 'distribute', 'broadcast'],
}

/**
 * Generates search aliases for an operation name by finding synonyms
 * for action verbs in the operation name.
 */
function generateAliases(operationName: string): string[] {
  const aliases: string[] = []
  const lowerName = operationName.toLowerCase()

  for (const [verb, synonyms] of Object.entries(ACTION_VERB_ALIASES)) {
    if (lowerName.includes(verb)) {
      for (const synonym of synonyms) {
        aliases.push(lowerName.replace(verb, synonym))
      }
    }
  }

  return aliases
}

/**
 * Extracts the operation dropdown subblock from a block's configuration.
 * Returns null if no operation dropdown exists.
 */
function findOperationDropdown(block: BlockConfig): SubBlockConfig | null {
  return (
    block.subBlocks.find(
      (sb) => sb.id === 'operation' && sb.type === 'dropdown' && Array.isArray(sb.options)
    ) ?? null
  )
}

/**
 * Resolves the tool ID for a given operation using the block's tool config.
 * Falls back to checking tools.access if no config.tool function exists.
 */
function resolveToolId(block: BlockConfig, operationId: string): string | null {
  if (!block.tools) return null

  if (block.tools.config?.tool) {
    try {
      return block.tools.config.tool({ operation: operationId })
    } catch {
      return null
    }
  }

  if (block.tools.access?.length === 1) {
    return block.tools.access[0]
  }

  return null
}

/**
 * Builds an index of all tool operations from the block registry.
 * This index is used by the search modal to enable operation-level discovery.
 *
 * The function iterates through all blocks that have:
 * 1. A tools.access array (indicating they use tools)
 * 2. An "operation" dropdown subblock with options
 *
 * For each operation option, it creates a ToolOperationItem that maps
 * the operation to its corresponding tool.
 */
export function buildToolOperationsIndex(): ToolOperationItem[] {
  const operations: ToolOperationItem[] = []
  const allBlocks = getAllBlocks()

  for (const block of allBlocks) {
    if (!block.tools?.access?.length || block.hideFromToolbar) {
      continue
    }

    if (block.category !== 'tools') {
      continue
    }

    const operationDropdown = findOperationDropdown(block)
    if (!operationDropdown) {
      continue
    }

    const options =
      typeof operationDropdown.options === 'function'
        ? operationDropdown.options()
        : operationDropdown.options

    if (!options) continue

    for (const option of options) {
      if (!resolveToolId(block, option.id)) continue

      const operationName = option.label
      const aliases = generateAliases(operationName)

      operations.push({
        id: `${block.type}_${option.id}`,
        blockType: block.type,
        operationId: option.id,
        serviceName: block.name,
        operationName,
        icon: block.icon,
        bgColor: block.bgColor,
        aliases,
      })
    }
  }

  return operations
}

/**
 * Cached operations index to avoid rebuilding on every search.
 * The index is built lazily on first access.
 */
let cachedOperations: ToolOperationItem[] | null = null

/**
 * Returns the tool operations index, building it if necessary.
 * The index is cached after first build since block registry is static.
 */
export function getToolOperationsIndex(): ToolOperationItem[] {
  if (!cachedOperations) {
    cachedOperations = buildToolOperationsIndex()
  }
  return cachedOperations
}

/**
 * Clears the cached operations index.
 * Useful for testing or if blocks are dynamically modified.
 */
export function clearToolOperationsCache(): void {
  cachedOperations = null
}
