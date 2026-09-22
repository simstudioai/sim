/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest'
import type { CodaMcpClient } from '@/lib/sim-search/live/coda-mcp'
import { createCodaServiceVerifier } from '@/lib/sim-search/live/coda-service'
import type { NativeClient } from '@/lib/sim-search/live/types'

const doc = { id: 'allowed', name: 'Shared doc', browserLink: 'https://coda.io/d/doc' }
const reference = { id: 'coda://docs/allowed/pages/page', kind: 'mcp' }
const createClient = () => ({ json: vi.fn<NativeClient['json']>(), text: vi.fn() })

describe('Coda service document boundary', () => {
  it('checks service-token visibility once per document even when multiple pages match', async () => {
    const client = createClient()
    client.json.mockResolvedValue(doc)
    const verify = createCodaServiceVerifier(client, {})
    expect(await verify(reference)).toBe(true)
    expect(await verify({ ...reference, id: 'coda://docs/allowed/tables/table/rows/row' })).toBe(
      true
    )
    expect(
      await verify({ ...reference, id: 'superhuman://docs/allowed/pages/section-page#Title' })
    ).toBe(true)
    expect(client.json).toHaveBeenCalledExactlyOnceWith('/apis/v1/docs/allowed')
  })
  it('intersects explicit service document selections before loading source metadata', async () => {
    const client = createClient()
    client.json.mockResolvedValue(doc)
    const verify = createCodaServiceVerifier(client, { docIds: ['allowed'] })
    expect(await verify({ id: 'other' })).toBe(false)
    expect(await verify({ id: 'allowed' })).toBe(true)
    expect(client.json).toHaveBeenCalledTimes(1)
  })
  it('canonicalizes only official Coda URLs using the member MCP grant', async () => {
    const client = createClient()
    client.json.mockResolvedValue(doc)
    const mcp = {
      call: vi.fn<CodaMcpClient['call']>().mockResolvedValue({ docUri: 'coda://docs/allowed' }),
    }
    const verify = createCodaServiceVerifier(client, { docIds: 'allowed' }, mcp)
    expect(await verify({ id: 'https://docs.superhuman.com/d/doc' })).toBe(true)
    expect(mcp.call).toHaveBeenCalledExactlyOnceWith('url_convert', {
      action: 'decode',
      url: 'https://docs.superhuman.com/d/doc',
      scope: 'document',
    })
    for (const id of [
      'https://evil.example/doc',
      'https://coda.io:444/doc',
      'https://user@coda.io/doc',
      'coda://docs/allowed/../other',
    ])
      expect(await verify({ id })).toBe(false)
    expect(mcp.call).toHaveBeenCalledTimes(1)
    expect(client.json).toHaveBeenCalledTimes(1)
  })
  it('verifies Enterprise membership through the canonical organization document lookup', async () => {
    const client = createClient()
    client.json.mockResolvedValue({ items: [{ ...doc, workspaceId: 'workspace' }] })
    const verify = createCodaServiceVerifier(client, { organizationId: 'org-123' })
    expect(await verify(reference)).toBe(true)
    expect(client.json).toHaveBeenCalledExactlyOnceWith(
      '/apis/admin/v1/organizations/org-123/docs',
      { query: { docIds: 'allowed', limit: '1', fetchPermissionsMode: 'none' } }
    )
  })
  it.each([
    { items: [] },
    { items: [{ ...doc, id: 'other', workspaceId: 'workspace' }] },
    { items: [doc] },
    { items: [{ ...doc, workspaceId: 'workspace', isDeleted: true }] },
    { items: [{ ...doc, workspaceId: 'workspace', keyAccessRevoked: true }] },
    { items: [{ ...doc, workspaceId: 'workspace' }], nextPageToken: 'ambiguous' },
  ])(
    'rejects missing, mismatched, revoked, or ambiguous organization evidence: %j',
    async (row) => {
      const client = createClient()
      client.json.mockResolvedValue(row)
      expect(
        await createCodaServiceVerifier(client, { organizationId: 'org-123' })(reference)
      ).toBe(false)
    }
  )
  it('observes loss of source access on the next operation and propagates provider failures', async () => {
    const client = createClient()
    client.json
      .mockResolvedValueOnce(doc)
      .mockRejectedValueOnce(new Error('Provider denied access'))
    expect(await createCodaServiceVerifier(client, {})(reference)).toBe(true)
    await expect(createCodaServiceVerifier(client, {})(reference)).rejects.toThrow(
      'Provider denied access'
    )
  })
})
