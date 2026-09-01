/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { memoryOperations } from '@/lib/memory/application/operations'

describe('memory operation registry', () => {
  it('admits only executor delegation with semantic read and write roles', () => {
    expect(memoryOperations.list.minimumRole).toBe('read')
    expect(memoryOperations.read.minimumRole).toBe('read')
    expect(memoryOperations.append.minimumRole).toBe('write')
    expect(memoryOperations.delete.minimumRole).toBe('write')

    for (const operation of Object.values(memoryOperations)) {
      expect(operation.principalKinds).toEqual(['delegated'])
      expect(operation.delegatedServices).toEqual(['executor'])
      expect(operation.workspaceApiKey).toBe('deny')
    }
  })
})
