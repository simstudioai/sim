/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { WriteStubPolicy } from '@/lib/workflows/dry-run'
import type { ExecutionContext } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { answerUnsentWrite, unsentWriteFor } from '@/tools/side-effects'

/** Stubs one `slack_message` call from block `notify` and returns what the policy recorded. */
async function stubSlackMessage(
  registry: ResolvedSecretTraceRegistry,
  describeRequest: () => unknown
) {
  const policy = new WriteStubPolicy({ workflowId: 'wf-1', pausingBlocks: 'stub' })
  const params = {
    accessToken: 'oauth-token-123',
    apiKey: 'hosted-key-456',
    channel: 'ops',
    _context: { blockId: 'notify' },
  }
  const write = unsentWriteFor({
    toolId: 'slack_message',
    params,
    executionContext: { workflowId: 'wf-1', sideEffects: policy } as ExecutionContext,
  })
  if (!write) throw new Error('The policy sent the write')
  const response = await answerUnsentWrite(write, { params, registry, describeRequest })
  return { response, stubbed: policy.summary().stubbed }
}

describe('a write a dry run does not send', () => {
  it('records its request without the credentials the call resolved, wherever they appear', async () => {
    const { response, stubbed } = await stubSlackMessage(new ResolvedSecretTraceRegistry(), () => ({
      method: 'POST',
      url: 'https://slack.example/api?token=oauth-token-123',
      body: { channel: 'ops', text: 'sent with hosted-key-456', apiKey: 'hosted-key-456' },
    }))

    expect(response.success).toBe(true)
    expect(stubbed[0].request).toMatchObject({ method: 'POST', body: { channel: 'ops' } })
    const recorded = JSON.stringify(stubbed[0].request)
    expect(recorded).not.toContain('oauth-token-123')
    expect(recorded).not.toContain('hosted-key-456')
  })

  it('records no request when the run cannot vouch that no secret remains in it', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    registry.markIncomplete('secret-transformed-by-tool')

    const { response, stubbed } = await stubSlackMessage(registry, () => ({
      method: 'POST',
      url: 'https://slack.example/api',
      body: { channel: 'ops' },
    }))

    expect(response.success).toBe(true)
    expect(stubbed[0].request).toBeNull()
  })
})
