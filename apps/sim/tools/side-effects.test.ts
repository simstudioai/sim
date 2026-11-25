/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { DryRunSideEffects } from '@/lib/workflows/dry-run'
import type { ExecutionContext } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { answerUnsentWrite } from '@/tools/side-effects'

describe('a write a dry run does not send', () => {
  it('records its request without the credentials the call resolved, wherever they appear', () => {
    const dryRun = new DryRunSideEffects({ allowBlockIds: new Set(), pausingBlocks: 'stub' })
    const params = {
      accessToken: 'oauth-token-123',
      apiKey: 'hosted-key-456',
      channel: 'ops',
      _context: { blockId: 'notify' },
    }

    const response = answerUnsentWrite({
      toolId: 'slack_message',
      params,
      executionContext: { workflowId: 'wf-1', sideEffects: dryRun } as ExecutionContext,
      registry: new ResolvedSecretTraceRegistry(),
      describeRequest: () => ({
        method: 'POST',
        url: 'https://slack.example/api?token=oauth-token-123',
        body: { channel: 'ops', text: 'sent with hosted-key-456', apiKey: 'hosted-key-456' },
      }),
    })

    expect(response?.success).toBe(true)
    const [stubbed] = dryRun.summary().stubbed
    expect(stubbed.request).toMatchObject({ method: 'POST', body: { channel: 'ops' } })
    const recorded = JSON.stringify(stubbed.request)
    expect(recorded).not.toContain('oauth-token-123')
    expect(recorded).not.toContain('hosted-key-456')
  })
})
