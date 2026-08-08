/**
 * @vitest-environment node
 */

import { permissionSatisfies } from '@sim/platform-authz/workspace'
import { describe, expect, it } from 'vitest'
import { fileOperations } from '@/lib/workspace-files/application/operations'

describe('file operation registry', () => {
  it('keeps every workspace-key operation at or below the fixed write ceiling', () => {
    for (const operation of Object.values(fileOperations)) {
      if (operation.workspaceApiKey === 'allow') {
        expect(
          permissionSatisfies('write', operation.minimumRole),
          `${operation.id} exceeds the workspace API-key write ceiling`
        ).toBe(true)
      }
    }
  })

  it('uses unique stable operation IDs', () => {
    const ids = Object.values(fileOperations).map((operation) => operation.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps external sharing policy changes human-delegated', () => {
    expect(fileOperations.updateShare.workspaceApiKey).toBe('deny')
  })
})
