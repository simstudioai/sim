/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreateOpencodeClient } = vi.hoisted(() => ({
  mockCreateOpencodeClient: vi.fn(),
}))

vi.mock('@opencode-ai/sdk', () => ({
  createOpencodeClient: mockCreateOpencodeClient,
}))

import { createOpenCodeClient, resetOpenCodeClientForTesting } from '@/lib/opencode/client'

describe('createOpenCodeClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('OPENCODE_BASE_URL', 'http://localhost:4096')
    vi.stubEnv('OPENCODE_SERVER_USERNAME', 'opencode')
    vi.stubEnv('OPENCODE_SERVER_PASSWORD', 'password')
    mockCreateOpencodeClient.mockReturnValue({ session: {} })
    resetOpenCodeClientForTesting()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    resetOpenCodeClientForTesting()
  })

  it('reuses the same client instance across calls', () => {
    const firstClient = createOpenCodeClient()
    const secondClient = createOpenCodeClient()

    expect(firstClient).toBe(secondClient)
    expect(mockCreateOpencodeClient).toHaveBeenCalledTimes(1)
  })

  it('recreates the client after resetting the cache', () => {
    const firstClient = { session: { id: 'first' } }
    const secondClient = { session: { id: 'second' } }
    mockCreateOpencodeClient.mockReturnValueOnce(firstClient).mockReturnValueOnce(secondClient)

    const initialClient = createOpenCodeClient()
    resetOpenCodeClientForTesting()
    const recreatedClient = createOpenCodeClient()

    expect(initialClient).toBe(firstClient)
    expect(recreatedClient).toBe(secondClient)
    expect(mockCreateOpencodeClient).toHaveBeenCalledTimes(2)
  })
})
