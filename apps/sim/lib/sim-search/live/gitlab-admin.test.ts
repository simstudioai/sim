import {
  knowledgeAccessScopeMock,
  knowledgeAccessScopeMockFns,
} from '@sim/testing/mocks/knowledge-access-scope.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { groupToken } from '@/lib/knowledge/access/tokens'
import { createAdminGitLabSession } from '@/lib/sim-search/live/gitlab-admin'
import {
  gitLabCsvGroupToken,
  setGitLabCsvContext,
} from '@/connectors/gitlab/permission-config/types'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  seed: vi.fn(),
  directory: vi.fn(),
  acl: vi.fn(),
  csv: vi.fn(),
  search: vi.fn(),
  read: vi.fn(),
  grant: vi.fn(),
}))
vi.mock('@/lib/knowledge/access/scope', () => knowledgeAccessScopeMock)
vi.mock('@/connectors/gitlab/permission-config/repository', () => ({
  seedGitLabCsvContext: mocks.seed,
}))
vi.mock('@/lib/knowledge/connectors/permission-store', () => ({
  hasConnectorPermissionGrant: mocks.grant,
}))
vi.mock('@/connectors/gitlab/permissions', () => ({
  openGitLabDirectory: mocks.directory,
  getGitLabDocumentAcls: mocks.acl,
  validateGitLabCsvToken: mocks.csv,
}))
vi.mock('@/lib/sim-search/live/gitlab', () => ({
  searchGitLab: mocks.search,
  readGitLab: mocks.read,
}))

const source = {
  id: 'source-a',
  config: { host: 'gitlab.example.com:8443', project: 'team/repo', contentTypes: 'all' },
}
const project = { id: 42, path_with_namespace: 'team/repo' }
const own = 'u:reader@example.com'
const grant = groupToken({
  providerId: 'gitlab',
  tenantId: 'gitlab.example.com%3A8443/42',
  groupId: 'repository',
})!
const client = { json: vi.fn(), text: vi.fn() }
const session = (config = source.config) =>
  createAdminGitLabSession({
    owner: { organizationId: 'org' },
    userId: 'reader',
    source: { ...source, config },
    token: 'admin-token',
    client,
    signal: AbortSignal.timeout(5000),
  })
const file = { id: 'src/a.ts', container: '42', kind: 'code', revision: 'main' }

beforeEach(() => {
  vi.resetAllMocks()
  knowledgeAccessScopeMockFns.mockCreateUserKnowledgeAccessProvider.mockImplementation(() => ({
    get: mocks.access,
  }))
  mocks.access.mockResolvedValue({ kind: 'user', userId: 'reader', tokens: [own] })
  mocks.directory.mockResolvedValue({
    providerId: 'gitlab',
    tenantId: 'gitlab.example.com%3A8443/42',
    listGroups: async () => [{ id: 'repository' }],
    listGroupMembers: async () => ({ complete: true, memberTokens: [own] }),
  })
  mocks.acl.mockImplementation(async (_token, _config, docs) =>
    Object.fromEntries(docs.map((doc: { externalId: string }) => [doc.externalId, [grant]]))
  )
  client.json.mockResolvedValue(project)
  mocks.search.mockResolvedValue({ documents: [] })
})

describe('administrator-managed live GitLab authorization', () => {
  it('requires the viewer’s verified identity even when an administrator token is available', async () => {
    mocks.access.mockResolvedValue({ kind: 'user', userId: 'reader', tokens: ['org', 'pub'] })
    await expect(session()).rejects.toThrow('verified organization identity')
    expect(mocks.directory).not.toHaveBeenCalled()
    expect(client.json).not.toHaveBeenCalled()
  })
  it('recomputes membership for each search/read operation and never uses stored administrator groups', async () => {
    expect(await (await session()).verify(file)).toBe(true)
    mocks.access.mockResolvedValue({ kind: 'user', userId: 'reader', tokens: [own, grant] })
    mocks.directory.mockResolvedValue({
      providerId: 'gitlab',
      tenantId: 'gitlab.example.com%3A8443/42',
      listGroups: async () => [{ id: 'repository' }],
      listGroupMembers: async () => ({ complete: true, memberTokens: [] }),
    })
    expect(await (await session()).verify(file)).toBe(false)
  })
  it('fails closed on incomplete permission enumeration', async () => {
    mocks.directory.mockResolvedValue({
      listGroups: async () => [{ id: 'repository' }],
      listGroupMembers: async () => ({ complete: false, memberTokens: [own] }),
    })
    await expect(session()).rejects.toThrow('could not be verified')
  })
  it('cannot widen the configured host/project through a native query or forged document reference', async () => {
    const current = await session()
    expect(
      await current.search({
        query: 'secret',
        limit: 10,
        scopes: [],
        native: { provider: 'gitlab', query: 'secret', project: 'other/private', kind: 'code' },
      })
    ).toEqual({ documents: [] })
    expect(await current.verify({ ...file, container: '99' })).toBe(false)
    expect(mocks.search).not.toHaveBeenCalled()
    expect(mocks.acl).not.toHaveBeenCalled()
  })
  it('gets current confidential issue and author metadata before invoking the canonical ACL evaluator', async () => {
    const current = await session()
    client.json.mockResolvedValue({
      project_id: 42,
      iid: 7,
      confidential: true,
      author: { id: 8 },
      assignees: [{ id: 9 }],
    })
    await current.verify({ id: '7', container: '42', kind: 'issues' })
    expect(mocks.acl).toHaveBeenCalledWith(
      'admin-token',
      source.config,
      [
        expect.objectContaining({
          externalId: 'issue:7',
          metadata: { confidential: true, authorId: 8, assigneeIds: [9] },
        }),
      ],
      expect.any(Object)
    )
  })
  it('checks confidentiality from the content response again before returning a document', async () => {
    const current = await session()
    client.json.mockResolvedValue({
      project_id: 42,
      iid: 7,
      confidential: false,
      author: { id: 8 },
      assignees: [],
    })
    mocks.read.mockResolvedValue({
      id: '7',
      container: '42',
      kind: 'issues',
      title: 'Secret',
      content: 'private',
      accessMetadata: { confidential: true, authorId: 9, assigneeIds: [] },
    })
    mocks.acl.mockImplementation(async (_token, _config, docs) => ({
      'issue:7': docs[0].metadata.confidential ? [] : [grant],
    }))
    await expect(current.read({ id: '7', container: '42', kind: 'issues' })).rejects.toThrow(
      'no longer available'
    )
    expect(mocks.acl).toHaveBeenCalledTimes(2)
  })
  it('propagates the caller deadline into the canonical permission directory', async () => {
    await session()
    expect(mocks.directory).toHaveBeenCalledWith(
      'admin-token',
      source.config,
      expect.any(Object),
      expect.any(AbortSignal)
    )
  })
})

describe('non-admin token and CSV permissions', () => {
  beforeEach(() => {
    mocks.grant.mockResolvedValue(true)
    mocks.seed.mockImplementation(async (_id, context) =>
      setGitLabCsvContext(context, {
        connectorId: 'source-a',
        host: 'gitlab.example.com:8443',
        projectId: 42,
        projectPath: 'team/repo',
      })
    )
    mocks.csv.mockResolvedValue({
      host: 'gitlab.example.com:8443',
      projectId: 42,
      projectPath: 'team/repo',
    })
    mocks.access.mockResolvedValue({
      kind: 'user',
      userId: 'reader',
      tokens: [own, gitLabCsvGroupToken('source-a')],
    })
    mocks.acl.mockResolvedValue({ 'file:src/a.ts': [gitLabCsvGroupToken('source-a')] })
  })
  it('uses the current connector-local grant without requiring a personal account or an admin token', async () => {
    expect(await (await session()).verify(file)).toBe(true)
    expect(mocks.directory).not.toHaveBeenCalled()
    expect(mocks.csv).toHaveBeenCalledWith('admin-token', source.config, expect.any(AbortSignal))
  })
  it('uses current CSV grants while a legacy indexed ACL rewrite remains pending', async () => {
    mocks.access.mockResolvedValue({ kind: 'user', userId: 'reader', tokens: [own] })

    expect(await (await session()).verify(file)).toBe(true)

    expect(mocks.grant).toHaveBeenCalledExactlyOnceWith('source-a', 'project', own)
  })
  it('does not accept a grant from another configured source', async () => {
    mocks.grant.mockResolvedValue(false)
    mocks.access.mockResolvedValue({
      kind: 'user',
      userId: 'reader',
      tokens: [own, gitLabCsvGroupToken('source-b')],
    })
    await expect(session()).rejects.toThrow('not available')
    expect(mocks.csv).not.toHaveBeenCalled()
  })
  it('fails closed when the configured project identity changes after the CSV was uploaded', async () => {
    mocks.csv.mockResolvedValue({
      host: 'gitlab.example.com:8443',
      projectId: 99,
      projectPath: 'team/repo',
    })
    await expect(session()).rejects.toThrow('update permissions')
  })
  it('observes CSV revocation on the next operation', async () => {
    expect(await (await session()).verify(file)).toBe(true)
    mocks.access.mockResolvedValue({ kind: 'user', userId: 'reader', tokens: [own] })
    mocks.grant.mockResolvedValue(false)
    await expect(session()).rejects.toThrow('not available')
  })
})
