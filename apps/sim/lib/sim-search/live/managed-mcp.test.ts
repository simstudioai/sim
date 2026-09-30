import { mcpServiceMock, mcpServiceMockFns } from '@sim/testing/mocks/mcp-service.mock'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ runtime: vi.fn(), auth: vi.fn() }))
vi.mock('@/lib/sim-search/live/mcp-accounts', () => ({ loadOwnManagedMcpRuntime: mocks.runtime }))
vi.mock('@/lib/mcp/service', () => mcpServiceMock)
vi.mock('@/lib/mcp/application/managed-auth-provider', () => ({
  createManagedMcpAuthProvider: mocks.auth,
}))

import { NativeSearchError } from '@/lib/sim-search/live/http'
import { createManagedSearchMcpClient } from '@/lib/sim-search/live/managed-mcp'
import { managedMcpPayload } from '@/lib/sim-search/live/managed-mcp-payload'

/** Failure modes: a write tool escapes the allowlist; replaced grants stay usable; payloads exhaust memory; schema drift changes tool meaning. */
describe('managed search MCP read boundary', () => {
  it('rejects write tools, changed grants, and invalid wire arguments before provider execution', async () => {
    const runtime = {
      mcpServerId: 'server',
      credentialId: 'mine',
      scope: { kind: 'organization', organizationId: 'org' },
      oauthConfigVersion: 1,
      grantedAt: new Date(0),
    }
    mocks.runtime.mockResolvedValue(runtime)
    mcpServiceMockFns.mockDiscoverManagedMcpTools.mockResolvedValue([
      {
        name: 'fireflies_get_transcripts',
        inputSchema: {
          type: 'object',
          properties: { keyword: { type: 'string' } },
          additionalProperties: false,
        },
      },
      { name: 'fireflies_share_meeting', inputSchema: { type: 'object' } },
    ])
    mcpServiceMockFns.mockExecuteManagedMcpTool.mockImplementation(async () => {
      throw new Error('Must not execute')
    })
    const client = await createManagedSearchMcpClient(
      { organizationId: 'org' },
      'person',
      'mine',
      'fireflies',
      new AbortController().signal
    )
    await expect(client.call('fireflies_share_meeting', {})).rejects.toThrow('read-only')
    await expect(client.call('fireflies_get_transcripts', { keyword: 42 })).rejects.toMatchObject({
      status: 'unavailable',
      message:
        'Fireflies rejected these search arguments. Its current tool schema is incompatible with this query.',
    })
    mocks.runtime.mockResolvedValue({ ...runtime, grantedAt: new Date(1) })
    await expect(client.call('fireflies_get_transcripts', { keyword: 'term' })).rejects.toThrow(
      'connection changed'
    )
  })

  it('withholds a response when its member grant is revoked during the provider request', async () => {
    let revoked = false
    mocks.runtime.mockImplementation(async () => {
      if (revoked) throw new NativeSearchError('reconnect', 'Member grant was revoked')
      return {
        mcpServerId: 'server',
        credentialId: 'mine',
        scope: { kind: 'organization', organizationId: 'org' },
        oauthConfigVersion: 1,
        grantedAt: new Date(0),
      }
    })
    mcpServiceMockFns.mockDiscoverManagedMcpTools.mockResolvedValue([
      { name: 'fireflies_get_transcripts', inputSchema: { type: 'object' } },
    ])
    mcpServiceMockFns.mockExecuteManagedMcpTool.mockImplementation(async () => {
      revoked = true
      return {
        structuredContent: { transcripts: [{ id: 'secret-meeting', title: 'Revoked content' }] },
      }
    })
    const client = await createManagedSearchMcpClient(
      { organizationId: 'org' },
      'person',
      'mine',
      'fireflies',
      new AbortController().signal
    )
    await expect(
      client.call('fireflies_get_transcripts', { keyword: 'term', scope: 'all' })
    ).rejects.toThrow('revoked')
  })

  it('rejects oversized and failed tool payloads without exposing provider errors', () => {
    expect(() =>
      managedMcpPayload(
        { content: [{ type: 'text', text: 'x'.repeat(4 * 1024 * 1024 + 1) }] },
        'Fireflies'
      )
    ).toThrow('size limit')
    expect(() =>
      managedMcpPayload(
        { isError: true, content: [{ type: 'text', text: 'secret token' }] },
        'Fireflies'
      )
    ).toThrow('could not complete')
  })

  it('makes a Granola OAuth account mismatch actionable without reflecting provider text', () => {
    let failure: unknown
    try {
      managedMcpPayload(
        {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'Unauthorized: user has not created a Granola account yet. private-provider-detail',
            },
          ],
        },
        'Granola'
      )
    } catch (error) {
      failure = error
    }
    expect(failure).toMatchObject({ status: 'reconnect' })
    expect(failure).toBeInstanceOf(NativeSearchError)
    expect((failure as NativeSearchError).message).toContain('existing Granola account')
    expect((failure as NativeSearchError).message).not.toContain('private-provider-detail')
  })
})
