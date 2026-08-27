/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ readResponseJsonWithLimit: vi.fn() }))

vi.mock('@/lib/core/utils/stream-limits', () => ({
  readResponseJsonWithLimit: mocks.readResponseJsonWithLimit,
}))

import { sendDiscordMessage } from '@/lib/internal/discord/client'

describe('sendDiscordMessage', () => {
  it('does not swallow cancellation while reading the provider response', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })))
    mocks.readResponseJsonWithLimit.mockImplementationOnce(async () => {
      controller.abort(new DOMException('cancelled', 'AbortError'))
      throw controller.signal.reason
    })

    await expect(
      sendDiscordMessage('token', '123', '{}', 'json', controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
