/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

const { mockExecuteProviderRequest } = vi.hoisted(() => ({
  mockExecuteProviderRequest: vi.fn(),
}))

vi.mock('@/lib/core/config/env', () => ({
  env: { MOTHERSHIP_MODEL: 'litellm/test-model' },
}))

vi.mock('@/providers', () => ({
  executeProviderRequest: mockExecuteProviderRequest,
}))

import { requestLocalChatTitle } from './title'

describe('requestLocalChatTitle', () => {
  it('uses the configured local model and normalizes the title', async () => {
    mockExecuteProviderRequest.mockResolvedValue({
      content: '"Inspect customer table"\nignored',
      model: 'litellm/test-model',
    })

    const title = await requestLocalChatTitle('What is in the customer table?')

    expect(title).toBe('Inspect customer table')
    expect(mockExecuteProviderRequest).toHaveBeenCalledWith(
      'litellm',
      expect.objectContaining({ model: 'litellm/test-model', stream: false, maxTokens: 24 })
    )
  })
})
