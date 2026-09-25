import { beforeEach, describe, expect, it, vi } from 'vitest'
import { codaConnector } from '@/connectors/coda/coda'
import {
  codaPermissionTokens,
  openCodaDirectory,
  resolveCodaAcls,
} from '@/connectors/coda/permissions'
import type { ExternalDocument } from '@/connectors/types'

const doc = {
  id: 'doc-1',
  name: 'Doc',
  browserLink: 'https://coda.io/d/_ddoc-1',
  updatedAt: '2026-09-16T00:00:00Z',
  owner: 'owner@example.com',
  workspaceId: 'ws-1',
}
const stub: ExternalDocument = {
  externalId: 'doc-1/pages/canvas-1',
  title: 'Page',
  content: '',
  contentHash: 'same',
  mimeType: 'text/plain',
}
let admin: Record<string, unknown> = { mirrorsSourceAcls: true }

describe('Coda source permissions', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    admin = { mirrorsSourceAcls: true }
  })

  it('keeps case-sensitive Coda group IDs distinct after shared group normalization', () => {
    const tokens = codaPermissionTokens(
      [
        { access: 'readonly', principal: { type: 'group', groupId: 'grp-X' } },
        { access: 'readonly', principal: { type: 'group', groupId: 'grp-x' } },
      ],
      undefined,
      'org-1'
    )
    expect(tokens).toEqual(['g:coda:org-1:group:6772702d58', 'g:coda:org-1:group:6772702d78'])
  })

  it('maps direct grants and ownership but never broadens link, domain, workspace, or unknown access', () => {
    expect(
      codaPermissionTokens(
        [
          { access: 'readonly', principal: { type: 'email', email: 'Reader@Example.com' } },
          { access: 'comment', principal: { type: 'email', email: 'comment@example.com' } },
          { access: 'none', principal: { type: 'email', email: 'denied@example.com' } },
          { access: 'future-access', principal: { type: 'email', email: 'unknown@example.com' } },
          { access: 'write', principal: { type: 'anyone' } },
          { access: 'readonly', principal: { type: 'domain', domain: 'example.com' } },
          { access: 'readonly', principal: { type: 'workspace', workspaceId: 'ws-1' } },
          { access: 'readonly', principal: { type: 'group', groupId: 'grp-1' } },
          { access: 'readonly', principal: { type: 'internalAccess' } },
        ],
        doc.owner
      )
    ).toEqual(['link', 'u:comment@example.com', 'u:owner@example.com', 'u:reader@example.com'])
  })

  it('namespaces Enterprise grants and gates registered users through directory status', () => {
    expect(
      codaPermissionTokens(
        [
          { access: 'write', principal: { type: 'email', email: 'Reader@Example.com' } },
          { access: 'readonly', principal: { type: 'domain', domain: 'Example.COM' } },
          { access: 'readonly', principal: { type: 'workspace', workspaceId: 'ws-1' } },
          { access: 'readonly', principal: { type: 'group', groupId: 'grp-1' } },
        ],
        undefined,
        'org-1'
      )
    ).toEqual([
      'g:coda:org-1:domain:example.com',
      'g:coda:org-1:group:6772702d31',
      'g:coda:org-1:user:reader@example.com',
      'g:coda:org-1:workspace:77732d31',
    ])
  })

  it('fails closed on an incomplete ACL instead of retaining the successfully read prefix', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(doc))
      .mockResolvedValueOnce(
        Response.json({
          items: [
            { access: 'readonly', principal: { type: 'email', email: 'reader@example.com' } },
          ],
          nextPageToken: 'next',
        })
      )
      .mockResolvedValueOnce(Response.json({}, { status: 403 }))
    expect(await resolveCodaAcls('token', {}, [stub], admin)).toEqual({})
  })

  it('ignores untrusted metadata doc IDs and refuses documents outside the selected scope', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    expect(
      await resolveCodaAcls(
        'token',
        { docIds: ['other'] },
        [{ ...stub, metadata: { docId: 'other' } }],
        admin
      )
    ).toEqual({})
    expect(fetch).not.toHaveBeenCalled()
  })

  it('opens the Enterprise directory lazily and excludes deactivated or deleted users', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        Response.json({
          items: [
            { email: 'active@example.com', status: 'Active' },
            { email: 'disabled@example.com', status: 'Deactivated' },
            { email: 'deleted@example.com', status: 'Deleted' },
          ],
        })
      )
      .mockResolvedValueOnce(Response.json({ items: [{ id: 'grp-X' }] }))
      .mockResolvedValueOnce(Response.json({ items: [{ id: 'ws-X' }] }))
      .mockResolvedValueOnce(
        Response.json({
          items: [{ email: 'active@example.com' }, { email: 'disabled@example.com' }],
          nextPageToken: 'members-2',
        })
      )
      .mockResolvedValueOnce(Response.json({ items: [{ email: 'guest@external.com' }] }))
    const directory = openCodaDirectory('token', 'org-1')
    expect(fetch).not.toHaveBeenCalled()
    const groups = await directory.listGroups()
    expect(groups).toContainEqual({ id: 'domain:example.com' })
    expect(
      (await directory.listGroupMembers({ id: 'user:disabled@example.com' })).memberTokens
    ).toEqual([])
    expect((await directory.listGroupMembers({ id: 'domain:example.com' })).memberTokens).toEqual([
      'u:active@example.com',
    ])
    expect((await directory.listGroupMembers({ id: 'group:6772702d58' })).memberTokens).toEqual([
      'u:active@example.com',
      'u:guest@external.com',
    ])
    expect(String(fetch.mock.calls[4][0])).toBe(
      'https://coda.io/apis/admin/v1/organizations/org-1/groups/grp-X/members?pageToken=members-2'
    )
  })

  it('throws on malformed or partial directories instead of replacing memberships', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({ items: [{ email: 'bad' }] })
    )
    await expect(openCodaDirectory('token', 'org-1').listGroups()).rejects.toThrow(
      'invalid response'
    )
  })

  it('uses the Admin API only for mirrored access with an explicit organization', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ items: [doc] }))
      .mockResolvedValueOnce(
        Response.json({
          items: [{ id: 'canvas-1', name: 'Page', browserLink: 'https://coda.io/d/page' }],
        })
      )

      .mockResolvedValueOnce(
        Response.json({
          id: 'canvas-1',
          name: 'Page',
          browserLink: 'https://coda.io/d/page',
          pageContent: { content: 'Admin page body' },
        })
      )
    const config = { docIds: ['doc-1'], organizationId: 'org-1' }
    const listed = await codaConnector.listDocuments('token', config, undefined, admin)
    expect(listed.hasMore).toBe(false)
    const full = await codaConnector.getDocument(
      'token',
      config,
      listed.documents[0].externalId,
      admin
    )
    expect(full?.content).toContain('Admin page body')
    expect(full?.contentHash).toBe(listed.documents[0].contentHash)
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      'https://coda.io/apis/admin/v1/organizations/org-1/docs?docIds=doc-1&limit=1&fetchPermissionsMode=none',
      'https://coda.io/apis/admin/v1/organizations/org-1/workspaces/ws-1/docs/doc-1/pages?limit=100',
      'https://coda.io/apis/admin/v1/organizations/org-1/workspaces/ws-1/docs/doc-1/pages/canvas-1?outputFormat=LossyPlainText',
    ])
  })

  it('uses current workspace-qualified permissions and rejects ambiguous metadata lookups', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ items: [doc] }))
      .mockResolvedValueOnce(
        Response.json({
          items: [{ access: 'readonly', principal: { type: 'workspace', workspaceId: 'ws-1' } }],
        })
      )
      .mockResolvedValueOnce(Response.json({ items: [doc], nextPageToken: 'unexpected' }))
    const config = { docIds: ['doc-1'], organizationId: 'org-1' }
    expect((await resolveCodaAcls('token', config, [stub], admin))[stub.externalId]).toContain(
      'g:coda:org-1:workspace:77732d31'
    )
    expect(String(fetch.mock.calls[1][0])).toBe(
      'https://coda.io/apis/admin/v1/organizations/org-1/workspaces/ws-1/docs/doc-1/acl/permissions?limit=100'
    )
    expect(await resolveCodaAcls('token', config, [stub], admin)).toEqual({})
  })

  it('rejects organization cursors after a scope change', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ items: [doc] }))
      .mockResolvedValueOnce(Response.json({ items: [], nextPageToken: 'more' }))
    const listed = await codaConnector.listDocuments(
      'token',
      { docIds: ['doc-1'], organizationId: 'org-1' },
      undefined,
      admin
    )
    await expect(
      codaConnector.listDocuments(
        'token',
        { docIds: ['doc-1'], organizationId: 'org-2' },
        listed.nextCursor,
        admin
      )
    ).rejects.toThrow('different source')
  })
})
