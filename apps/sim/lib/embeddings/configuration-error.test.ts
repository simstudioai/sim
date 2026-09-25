import { apiKeyByokMock, apiKeyByokMockFns } from '@sim/testing/mocks/api-key-byok.mock'
import { setEnv } from '@sim/testing/mocks/env.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rotation: vi.fn() }))
vi.mock('@/lib/api-key/byok', () => apiKeyByokMock)
vi.mock('@/lib/core/config/api-keys', () => ({ getRotatingApiKey: mocks.rotation }))

import { resolveProviderKey } from '@/lib/embeddings/keys'
import { messageForCopilotApplicationError } from '@/lib/mothership/application/error'

setEnv({ OPENAI_API_KEY: undefined })

describe('embedding configuration capability failure', () => {
  beforeEach(() => {
    apiKeyByokMockFns.mockGetBYOKKey.mockReset().mockResolvedValue(null)
    mocks.rotation.mockReset().mockImplementation(() => {
      throw new Error('private provider setup details')
    })
  })
  it('preserves usable BYOK and does not probe platform rotation', async () => {
    apiKeyByokMockFns.mockGetBYOKKey.mockResolvedValue({
      apiKey: 'test-provider-key',
      scope: 'workspace',
    })
    expect(await resolveProviderKey('openai', 'workspace')).toEqual({
      apiKey: 'test-provider-key',
      isBYOK: true,
    })
    expect(mocks.rotation).not.toHaveBeenCalled()
  })
  it('does not relabel authorization or infrastructure failures as missing configuration', async () => {
    const error = new Error('private database details')
    apiKeyByokMockFns.mockGetBYOKKey.mockRejectedValue(error)
    await expect(resolveProviderKey('openai', 'workspace')).rejects.toBe(error)
    expect(messageForCopilotApplicationError(error, 'generic')).toBe('generic')
  })
})
