import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ byok: vi.fn(), rotation: vi.fn() }))
vi.mock('@/lib/api-key/byok', () => ({ getBYOKKey: mocks.byok }))
vi.mock('@/lib/core/config/api-keys', () => ({ getRotatingApiKey: mocks.rotation }))
vi.mock('@/lib/core/config/env', () => ({ env: {} }))

import { resolveProviderKey } from '@/lib/embeddings/keys'
import { messageForCopilotApplicationError } from '@/lib/mothership/application/error'

describe('embedding configuration capability failure', () => {
  beforeEach(() => {
    mocks.byok.mockReset().mockResolvedValue(null)
    mocks.rotation.mockReset().mockImplementation(() => {
      throw new Error('private provider setup details')
    })
  })
  it('preserves usable BYOK and does not probe platform rotation', async () => {
    mocks.byok.mockResolvedValue({ apiKey: 'test-provider-key', scope: 'workspace' })
    expect(await resolveProviderKey('openai', 'workspace')).toEqual({
      apiKey: 'test-provider-key',
      isBYOK: true,
    })
    expect(mocks.rotation).not.toHaveBeenCalled()
  })
  it('does not relabel authorization or infrastructure failures as missing configuration', async () => {
    const error = new Error('private database details')
    mocks.byok.mockRejectedValue(error)
    await expect(resolveProviderKey('openai', 'workspace')).rejects.toBe(error)
    expect(messageForCopilotApplicationError(error, 'generic')).toBe('generic')
  })
})
