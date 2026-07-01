/**
 * @vitest-environment node
 */
import type Anthropic from '@anthropic-ai/sdk'
import type { TextBlockParam } from '@anthropic-ai/sdk/resources'
import { describe, expect, it, vi } from 'vitest'
import { executeAnthropicProviderRequest } from '@/providers/anthropic/core'
import type { ProviderRequest } from '@/providers/types'

const LARGE = 'x'.repeat(8_000) // ~2,000 est. tokens, above the 1,024 gate
const SMALL = 'x'.repeat(400) // ~100 est. tokens, below the gate

/**
 * Drives the real `executeAnthropicProviderRequest` down the streaming/no-tools
 * path and captures the request payload handed to `messages.create`, injecting
 * only the client via the `createClient` seam (real models/utils/attachments run).
 * The streaming path builds its stream lazily, so an empty async iterable suffices.
 */
async function captureRequestPayload(
  request: Partial<ProviderRequest>
): Promise<Record<string, unknown>> {
  let captured: Record<string, unknown> = {}
  const fakeClient = {
    messages: {
      create: vi.fn(async (payload: Record<string, unknown>) => {
        captured = payload
        return (async function* () {})()
      }),
    },
  } as unknown as Anthropic

  await executeAnthropicProviderRequest(
    {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'test-key',
      stream: true,
      ...request,
    } as ProviderRequest,
    {
      providerId: 'anthropic',
      providerLabel: 'Anthropic',
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
      createClient: () => fakeClient,
    }
  )

  return captured
}

describe('executeAnthropicProviderRequest prompt caching (request capture)', () => {
  it('emits a cache_control-tagged system block for a large system prompt', async () => {
    const payload = await captureRequestPayload({ systemPrompt: LARGE })

    expect(Array.isArray(payload.system)).toBe(true)
    const blocks = payload.system as TextBlockParam[]
    expect(blocks[0]).toMatchObject({ type: 'text', cache_control: { type: 'ephemeral' } })
  })

  it('leaves a small system prompt as a plain string (no cache_control)', async () => {
    const payload = await captureRequestPayload({ systemPrompt: SMALL })

    expect(typeof payload.system).toBe('string')
    expect(payload.system).toBe(SMALL)
  })
})
