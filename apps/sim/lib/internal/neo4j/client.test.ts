import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { openNeo4jConnection } from '@/lib/internal/neo4j/client'

describe('openNeo4jConnection', () => {
  it('rejects an out-of-range port instead of throwing from the relay', async () => {
    inputValidationMockFns.mockValidateDatabaseHost.mockResolvedValue({
      isValid: true,
      resolvedIP: '127.0.0.1',
    })
    await expect(
      openNeo4jConnection({
        host: 'neo4j.invalid',
        port: 65_536,
        database: 'neo4j',
        username: 'neo4j',
        password: 'secret',
        encryption: 'enabled',
      })
    ).rejects.toThrow('Port must be an integer between 1 and 65535')
  })
})
