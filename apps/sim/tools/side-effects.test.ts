/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { maskClientMock, maskClientMockFns } from '@sim/testing/mocks/mask-client.mock'
import { describe, expect, it, vi } from 'vitest'
import { WriteStubPolicy } from '@/lib/workflows/dry-run'
import type { PiiBlockOutputRedaction } from '@/executor/execution/types'
import type { ExecutionContext } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import {
  answerCheckedMcpCall,
  answerUnsentCall,
  codeNetworkFor,
  describeMcpToolRequest,
  unsentWriteFor,
} from '@/tools/side-effects'

vi.mock('@/lib/guardrails/mask-client', () => maskClientMock)

const PII_REDACTION: PiiBlockOutputRedaction = {
  enabled: true,
  entityTypes: ['EMAIL_ADDRESS'],
  language: 'en',
}

/** The write the dry-run policy holds back for a `toolId` call from block `notify`. */
function unsentWrite(
  toolId: string,
  params: Record<string, unknown>,
  piiBlockOutputRedaction?: PiiBlockOutputRedaction
) {
  const policy = new WriteStubPolicy({ workflowId: 'wf-1' })
  const write = unsentWriteFor({
    toolId,
    params,
    executionContext: {
      ...createExecutionContext({ workflowId: 'wf-1' }),
      sideEffects: policy,
      piiBlockOutputRedaction,
    } as ExecutionContext,
  })
  if (!write) throw new Error('The policy sent the write')
  return { write, policy }
}

/** Stubs one `slack_message` call whose request is `request` and returns what the policy recorded. */
async function stubSlackMessage(
  registry: ResolvedSecretTraceRegistry,
  request: unknown,
  piiBlockOutputRedaction?: PiiBlockOutputRedaction
) {
  const params = {
    accessToken: 'oauth-token-123',
    apiKey: 'hosted-key-456',
    channel: 'ops',
    _context: { blockId: 'notify' },
  }
  const { write, policy } = unsentWrite('slack_message', params, piiBlockOutputRedaction)
  const response = await answerUnsentCall(write, { params, registry, describe: () => request })
  return { response, stubbed: policy.summary().stubbed }
}

describe('a write a dry run does not send', () => {
  it('records its request without the credentials the call resolved, wherever they appear', async () => {
    const { response, stubbed } = await stubSlackMessage(new ResolvedSecretTraceRegistry(), {
      method: 'POST',
      url: 'https://slack.example/api?token=oauth-token-123',
      body: { channel: 'ops', text: 'sent with hosted-key-456', apiKey: 'hosted-key-456' },
    })

    expect(response.success).toBe(true)
    expect(stubbed[0].request).toMatchObject({ method: 'POST', body: { channel: 'ops' } })
    const recorded = JSON.stringify(stubbed[0].request)
    expect(recorded).not.toContain('oauth-token-123')
    expect(recorded).not.toContain('hosted-key-456')
  })

  it('records no request when the run cannot vouch that no secret remains in it', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    registry.markIncomplete('projection-mismatch')

    const { response, stubbed } = await stubSlackMessage(registry, {
      method: 'POST',
      url: 'https://slack.example/api',
      body: { channel: 'ops' },
    })

    expect(response.success).toBe(true)
    expect(stubbed[0].request).toBeNull()
  })

  it('records its request with the workspace’s PII redaction applied, as a block output gets it', async () => {
    maskClientMockFns.mockMaskPIIBatchViaHttp.mockImplementationOnce(async (texts: string[]) => ({
      masked: texts.map((text) => text.replaceAll('ada@example.com', '<EMAIL_ADDRESS>')),
      scrubbedCount: 0,
    }))

    const { stubbed } = await stubSlackMessage(
      new ResolvedSecretTraceRegistry(),
      { method: 'POST', body: { channel: 'ops', text: 'Reply to ada@example.com' } },
      PII_REDACTION
    )

    expect(stubbed[0].request).toMatchObject({ body: { text: 'Reply to <EMAIL_ADDRESS>' } })
    expect(JSON.stringify(stubbed[0].request)).not.toContain('ada@example.com')
  })

  it('records no request when the PII redaction fails', async () => {
    maskClientMockFns.mockMaskPIIBatchViaHttp.mockRejectedValueOnce(new Error('Presidio down'))

    const { response, stubbed } = await stubSlackMessage(
      new ResolvedSecretTraceRegistry(),
      { method: 'POST', body: { channel: 'ops', text: 'Reply to ada@example.com' } },
      PII_REDACTION
    )

    expect(response.success).toBe(true)
    expect(stubbed[0].request).toBeNull()
  })

  it('builds its request from params whose secrets are already masked, so no encoding carries one', async () => {
    const params = {
      apiKey: 'hosted-key-456',
      content: 'sent with hosted-key-456',
      _context: { blockId: 'notify' },
    }
    const { write, policy } = unsentWrite('slack_message', params)

    await answerUnsentCall(write, {
      params,
      registry: new ResolvedSecretTraceRegistry(),
      describe: (masked) => ({ body: Buffer.from(String(masked.content)).toString('base64') }),
    })

    const [{ request }] = policy.summary().stubbed
    const body = Buffer.from(String(request?.body), 'base64').toString('utf8')
    expect(body).toBe('sent with [REDACTED]')
  })

  it.each([
    ['an object', { connection: { apiKey: 'nested-key-789' }, note: 'key nested-key-789' }],
    [
      'a JSON string',
      JSON.stringify({ connection: { apiKey: 'nested-key-789' }, note: 'key nested-key-789' }),
    ],
  ])(
    'masks a secret nested in MCP arguments given as %s wherever it reappears',
    async (_, args) => {
      const params = { arguments: args, _context: { blockId: 'notify' } }
      const { write, policy } = unsentWrite('mcp-server-1-create_issue', params)

      await answerCheckedMcpCall(
        write,
        { success: true, output: {} },
        {
          params,
          registry: new ResolvedSecretTraceRegistry(),
          describe: describeMcpToolRequest,
        }
      )

      const [{ request }] = policy.summary().stubbed
      expect(request).toEqual({
        arguments: { connection: { apiKey: '[REDACTED]' }, note: 'key [REDACTED]' },
      })
    }
  )
})

/** The dry-run policy's network for code run by block `blockId`, given `params`. */
function codeNetwork(blockId: string, params: Record<string, unknown> = {}) {
  const policy = new WriteStubPolicy({ workflowId: 'wf-1' })
  const network = codeNetworkFor({
    executionContext: {
      ...createExecutionContext({ workflowId: 'wf-1' }),
      sideEffects: policy,
    } as ExecutionContext,
    params: { ...params, _context: { blockId } },
    registry: new ResolvedSecretTraceRegistry(),
  })
  if (!network) throw new Error('The run has no side-effect policy')
  return { network, policy }
}

describe('code a dry run runs', () => {
  it('is listed unchecked when it runs in a remote sandbox, whose network it cannot see', () => {
    const { network, policy } = codeNetwork('python')

    network.ranInRemoteSandbox()

    expect(policy.summary().unchecked).toEqual([
      expect.objectContaining({
        blockId: 'python',
        reason: expect.stringContaining('remote sandbox'),
      }),
    ])
  })

  it('is listed unchecked, not allowed, when its block is allowed and it runs in a remote sandbox', () => {
    const policy = new WriteStubPolicy({ workflowId: 'wf-1', allowBlockIds: new Set(['python']) })
    const code = policy.codeNetwork({
      workflowId: 'wf-1',
      blockId: 'python',
      blockName: 'python',
      blockType: 'function',
    })

    code.ranInRemoteSandbox()

    expect(policy.summary().unchecked).toEqual([expect.objectContaining({ blockId: 'python' })])
    expect(policy.summary().allowed).toEqual([])
  })

  it('records a long stubbed body masked before it is capped, so no secret is cut in two', async () => {
    const secret = 'code-secret-0123456789'
    const { network, policy } = codeNetwork('code', { apiKey: secret })
    const body = `${'a'.repeat(4090)}${secret}`

    const decision = await network.fetchPolicy({
      method: 'POST',
      url: 'https://hook.example/x',
      headerNames: [],
      headerValues: [],
      body,
    })

    expect(decision).toBe('stub')
    const [{ request }] = policy.summary().stubbed
    expect(String(request?.body)).toContain(`${'a'.repeat(4090)}[REDA`)
    expect(String(request?.body)).not.toContain(secret.slice(0, 6))
  })

  it('still stubs a request whose description cannot be built, recording no request', async () => {
    const policy = new WriteStubPolicy({ workflowId: 'wf-1' })
    const code = policy.codeNetwork({
      workflowId: 'wf-1',
      blockId: 'code',
      blockName: 'code',
      blockType: 'function',
    })

    const decision = await code.onRequest({
      method: 'POST',
      url: 'https://hook.example/x',
      headerNames: [],
      headerValues: [],
      body: undefined,
      describe: async () => {
        throw new Error('redaction failed')
      },
    })

    expect(decision).toBe('stub')
    expect(policy.summary().stubbed.map((entry) => entry.request)).toEqual([null])
  })

  it('stops describing stubbed requests once the list is full, counting the rest', async () => {
    const policy = new WriteStubPolicy({ workflowId: 'wf-1' })
    const code = policy.codeNetwork({
      workflowId: 'wf-1',
      blockId: 'code',
      blockName: 'code',
      blockType: 'function',
    })
    let described = 0
    const request = {
      method: 'POST',
      url: 'https://hook.example/x',
      headerNames: [],
      headerValues: [],
      body: undefined,
      describe: async () => {
        described++
        return { method: 'POST' }
      },
    }

    for (let call = 0; call < 60; call++) await code.onRequest(request)

    expect(described).toBe(50)
    expect(policy.summary().omitted.stubbed).toBe(10)
  })
})
