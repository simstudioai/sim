/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ importPersonaAccounts: vi.fn() }))

vi.mock('@/lib/internal/persona/operations', () => ({
  importPersonaAccounts: mocks.importPersonaAccounts,
}))

import { executePersonaTool } from '@/lib/internal/persona/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

describe('executePersonaTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.importPersonaAccounts.mockResolvedValue({ success: true, output: {} })
  })

  it('uses the trusted execution user for stored-file authorization', async () => {
    const controller = new AbortController()
    const input = {
      apiKey: 'token',
      file: { key: 'workspace/file.csv', name: 'file.csv', size: 3 },
    }
    const request: InternalToolOperationCall = {
      toolId: 'persona_import_accounts',
      input,
      headers: new Headers(),
      context: { ...createExecutionContext(), userId: 'user-1' },
      requestId: 'request-1',
      signal: controller.signal,
    }

    expect((await executePersonaTool(request)).status).toBe(200)
    expect(mocks.importPersonaAccounts).toHaveBeenCalledWith(input, {
      userId: 'user-1',
      requestId: 'request-1',
      signal: controller.signal,
    })
  })
})
