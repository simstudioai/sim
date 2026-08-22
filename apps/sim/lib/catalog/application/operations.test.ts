/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { catalogOperations } from '@/lib/catalog/application/operations'

/**
 * Operation metadata is executable policy, not documentation: it decides which
 * principals reach the use case and at what role. Pinning it here makes
 * widening any of the six a deliberate edit rather than a side effect.
 */
const EXPECTED_OPERATION_IDS = {
  listBlocks: 'catalog.blocks.list',
  readBlock: 'catalog.blocks.read',
  listTools: 'catalog.tools.list',
  readTool: 'catalog.tools.read',
  listConnectorTypes: 'catalog.connector_types.list',
} as const

describe('catalogOperations', () => {
  it('declares exactly the five catalog reads under their published ids', () => {
    expect(Object.keys(catalogOperations).sort()).toEqual(
      Object.keys(EXPECTED_OPERATION_IDS).sort()
    )
    for (const [key, id] of Object.entries(EXPECTED_OPERATION_IDS)) {
      expect(catalogOperations[key as keyof typeof catalogOperations].id).toBe(id)
    }
  })

  it('keeps every catalog read at the read role with workspace keys allowed', () => {
    for (const operation of Object.values(catalogOperations)) {
      expect(operation.minimumRole, operation.id).toBe('read')
      expect(operation.workspaceApiKey, operation.id).toBe('allow')
      expect([...operation.principalKinds].sort(), operation.id).toEqual([
        'personal_api_key',
        'session',
        'workspace_api_key',
      ])
    }
  })

  it('admits no delegated principal, because no delegated caller exists yet', () => {
    for (const operation of Object.values(catalogOperations)) {
      expect(operation.principalKinds, operation.id).not.toContain('delegated')
      expect(operation.delegatedServices, operation.id).toBeUndefined()
    }
  })

  it('freezes each operation so a caller cannot widen it at runtime', () => {
    for (const operation of Object.values(catalogOperations)) {
      expect(Object.isFrozen(operation), operation.id).toBe(true)
      expect(Object.isFrozen(operation.principalKinds), operation.id).toBe(true)
    }
  })
})
