import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceFileSecretProvenanceMock,
  workspaceFileSecretProvenanceMockFns,
} from '@sim/testing/mocks/workspace-file-secret-provenance.mock'
import {
  workspaceUploadsMock,
  workspaceUploadsMockFns,
} from '@sim/testing/mocks/workspace-uploads.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  search: vi.fn(),
  folders: vi.fn(),
}))
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/uploads/contexts/workspace', () => workspaceUploadsMock)
vi.mock('@/lib/workspace-files/search/repository', () => ({
  searchWorkspaceFileIndex: hoisted.search,
}))
vi.mock(
  '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance',
  () => workspaceFileSecretProvenanceMock
)
vi.mock('@/lib/workspace-files/resolve-folder-scope', () => ({
  resolveWorkspaceFolderScope: hoisted.folders,
}))

import { type ContentDeliveryGate, observeContentDelivery } from '@/lib/core/application'
import { markCopilotWorkspaceInvocation } from '@/lib/core/application/copilot-workspace-invocation'
import { createCopilotChatPrincipal } from '@/lib/mothership/auth/application-delegation'
import { WORKSPACE_FILES_DELEGATION_AUDIENCE } from '@/lib/workspace-files/application/authorization'
import { searchWorkspaceFileContent } from '@/lib/workspace-files/application/search-workspace-file-content'

const mocks = {
  load: workspaceUploadsMockFns.mockLoadActiveWorkspaceContext,
  ...hoisted,
  permission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
}

const principal = createSessionPrincipal()
const input = {
  workspaceId: 'workspace-1',
  query: 'needle',
  mode: 'exact',
  maxResults: 10,
} as const

describe('searchWorkspaceFileContent cancellation', () => {
  beforeEach(() => {
    mocks.load.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'user-1',
    })
    mocks.permission.mockResolvedValue('read')
    mocks.search.mockResolvedValue({ results: [] })
  })

  it('does not resolve folders or enqueue database work for a cancelled HTTP request', async () => {
    const signal = AbortSignal.abort(new Error('cancelled'))
    await expect(
      searchWorkspaceFileContent.execute({
        principal,
        input: { ...input, folderPaths: ['/notes'] },
        request: { headers: new Headers(), signal },
      })
    ).rejects.toBe(signal.reason)
    expect(mocks.folders).not.toHaveBeenCalled()
    expect(mocks.search).not.toHaveBeenCalled()
  })
})

/** A clipped preview cannot reliably redact a value split by the index. */
const cleanOnlyGate: ContentDeliveryGate = {
  async admit(sources) {
    return sources.map(
      ({ provenance }) => provenance.status === 'exact' && provenance.entries.length === 0
    )
  },
}

function copilotPrincipal() {
  const copilot = createCopilotChatPrincipal(
    { userId: 'user-1', workspaceId: 'workspace-1', chatId: 'chat-1' },
    WORKSPACE_FILES_DELEGATION_AUDIENCE
  )
  markCopilotWorkspaceInvocation(copilot)
  return copilot
}

function source(fileId: string) {
  return { identity: { fileId, key: `key-${fileId}`, context: 'workspace' as const } }
}

function hit(fileId: string, lineNumber: number) {
  return { fileId, lineNumber, text: `needle ${lineNumber}` }
}

describe('searchWorkspaceFileContent for Chat', () => {
  beforeEach(() => {
    mocks.load.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'user-1',
    })
    mocks.permission.mockResolvedValue('read')
    workspaceFileSecretProvenanceMockFns.mockGetBoundWorkspaceFileSecretProvenanceByIdentity.mockImplementation(
      async (_workspaceId: string, identities: readonly { fileId: string }[]) =>
        new Map(
          identities.map((identity) => [
            identity.fileId,
            identity.fileId === 'refused'
              ? { status: 'unknown' }
              : { status: 'exact', entries: [] },
          ])
        )
    )
  })

  it('preserves match locations while withholding unreadable previews', async () => {
    mocks.search.mockResolvedValue({
      results: [hit('refused', 1), hit('clean', 3)],
      count: 2,
      truncated: false,
      complete: true,
      indexStatus: 'ready',
      sources: [source('refused'), source('clean')],
    })
    const found = await observeContentDelivery(cleanOnlyGate, () =>
      searchWorkspaceFileContent.execute({
        principal: copilotPrincipal(),
        input: { ...input, maxResults: 2 },
      })
    )
    expect(mocks.search.mock.calls[0]?.[0].maxResults).toBe(2)
    expect(found.results.map((result) => result.lineNumber)).toEqual([1, 3])
    expect(found.results[0].text).toMatch(/preview withheld/i)
    expect(found.results[1].text).toBe('needle 3')
    expect(found).toMatchObject({ count: 2, truncated: false })
    expect(found.sources.map((entry) => entry.identity.fileId)).toEqual(['clean'])
  })

  it('keeps truthful truncation when a page contains only unreadable previews', async () => {
    mocks.search.mockResolvedValue({
      results: [hit('refused', 1)],
      count: 1,
      truncated: true,
      complete: true,
      indexStatus: 'ready',
      sources: [source('refused')],
    })
    const found = await observeContentDelivery(cleanOnlyGate, () =>
      searchWorkspaceFileContent.execute({
        principal: copilotPrincipal(),
        input: { ...input, maxResults: 1 },
      })
    )
    expect(found).toMatchObject({ count: 1, truncated: true })
    expect(found.results[0]).toMatchObject({ fileId: 'refused', lineNumber: 1 })
    expect(found.results[0].text).toMatch(/preview withheld/i)
  })

  it("leaves a person's search limit and result untouched", async () => {
    const raw = {
      results: [hit('refused', 1)],
      count: 1,
      truncated: true,
      complete: true,
      indexStatus: 'ready',
      sources: [source('refused')],
    }
    mocks.search.mockResolvedValue(raw)
    const found = await searchWorkspaceFileContent.execute({ principal, input })
    expect(mocks.search.mock.calls[0]?.[0].maxResults).toBe(input.maxResults)
    expect(found).toBe(raw)
  })
})
