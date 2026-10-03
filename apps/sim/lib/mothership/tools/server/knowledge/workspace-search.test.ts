import { resetEnvFlagsMock } from '@sim/testing/mocks/env-flags.mock'
import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import {
  mothershipOrganizationChatsMock,
  mothershipOrganizationChatsMockFns,
} from '@sim/testing/mocks/mothership-organization-chats.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  search: vi.fn(),
  read: vi.fn(),
}))
vi.mock('@/lib/mothership/chat/organization-chats', () => mothershipOrganizationChatsMock)
vi.mock('@/lib/sim-search/live/application', () => ({
  searchLiveKnowledge: {
    get operation() {
      return knowledgeOperations.search
    },
    execute: hoisted.search,
  },
  readLiveDocument: {
    get operation() {
      return knowledgeOperations.readDocument
    },
    execute: hoisted.read,
  },
}))

import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { collectRetrievalCitationEvidence } from '@/lib/mothership/chat/citation-evidence'
import { compactRetrievalCitations } from '@/lib/mothership/chat/retrieval-citations'
import {
  readDocumentServerTool,
  searchWorkspaceServerTool,
} from '@/lib/mothership/tools/server/knowledge/workspace-search'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const mocks = {
  ...hoisted,
  authorizeChat: mothershipOrganizationChatsMockFns.mockAuthorizeOrganizationChatDelegation,
  info: getMockLogger('KnowledgeSearchDiagnostics').info,
}

const context = {
  userId: 'reader',
  workspaceId: 'workspace',
  toolCallId: 'call',
  copilotToolExecution: true,
  assistantSearch: { source: 'slack', documentIds: ['doc'] },
  resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry([], {
    userId: 'reader',
    workspaceId: 'workspace',
  }),
}
describe('Assistant retrieval tools', () => {
  afterEach(resetEnvFlagsMock)
  beforeEach(() => {
    mocks.search.mockImplementation(async ({ input }: { input: { query: string } }) => ({
      query: input.query,
      retrieval: { status: 'complete', timedOutLegs: [] },
      knowledgeBases: [{ id: 'index', name: 'Enterprise Search' }],
      results: [
        {
          knowledgeBaseId: 'index',
          documentId: 'doc',
          documentName: 'Title',
          sourceUrl: null,
          sourceModifiedAt: null,
          metadata: {},
          content: 'body',
          chunkIndex: 0,
          similarity: 1,
        },
      ],
    }))
    mocks.read.mockResolvedValue({
      knowledgeBaseId: 'index',
      documentId: 'doc',
      documentName: 'Title',
      sourceUrl: 'https://source.test/doc',
      chunks: [{ content: 'body', chunkIndex: 0 }],
      hasMore: false,
      next: null,
    })
  })
  for (const tool of [searchWorkspaceServerTool, readDocumentServerTool]) {
    describe(`${tool.name} live citations`, () => {
      it.each([
        {
          name: 'the source link before its container',
          sourceUrl: 'https://source.test/document',
          sourceContainerUrl: 'https://source.test/container',
          citationUrl: 'https://source.test/document',
        },
        {
          name: 'the container when the source has no link',
          sourceUrl: null,
          sourceContainerUrl: 'https://source.test/container',
          citationUrl: 'https://source.test/container',
        },
        {
          name: 'no citation link when neither destination is available',
          sourceUrl: null,
          sourceContainerUrl: undefined,
          citationUrl: null,
        },
      ])('preserves $name through saved citation evidence', async (links) => {
        const document = {
          knowledgeBaseId: '',
          documentId: 'live:opaque-reference',
          documentName: 'Live document',
          sourceUrl: links.sourceUrl,
          sourceContainerUrl: links.sourceContainerUrl,
          connectorType: 'slack',
          content: 'Retrieved evidence',
        }
        const searching = tool.name === 'search_workspace'
        if (searching) {
          mocks.search.mockResolvedValueOnce({
            retrieval: { status: 'complete', timedOutLegs: [] },
            results: [document],
          })
        } else {
          mocks.read.mockResolvedValueOnce({
            ...document,
            chunks: [{ chunkIndex: 0, content: document.content }],
            hasMore: false,
            next: null,
          })
        }
        const result = await tool.execute(
          searching ? { query: 'evidence' } : { documentId: document.documentId },
          { ...context, assistantSearch: undefined }
        )
        const expected = { documentId: document.documentId, citationUrl: links.citationUrl }
        expect(result).toMatchObject({
          success: true,
          data: searching ? { results: [expected] } : expected,
        })
        const evidence = collectRetrievalCitationEvidence([
          {
            toolCall: {
              name: tool.name,
              status: 'success',
              result: {
                success: true,
                output: compactRetrievalCitations(tool.name, result),
              },
            },
          },
        ])
        expect([...evidence.values()].map((source) => source.url)).toEqual(
          links.citationUrl ? [links.citationUrl] : []
        )
      })
    })
  }
  it.each([
    { provider: 'slack', kind: 'meeting' },
    { provider: 'google_drive', kind: 'transcript' },
  ])('rejects $provider searches with an unsupported $kind selector', async (selection) => {
    const result = await searchWorkspaceServerTool.execute(
      { query: 'release', nativeQueries: [{ ...selection, query: 'release' }] },
      { ...context, assistantSearch: undefined }
    )
    expect(result).toMatchObject({
      success: false,
      message: `${selection.provider} does not support kind selection.`,
    })
    expect(result).not.toHaveProperty('data')
  })

  it.each([
    { searchSurface: undefined, expected: 'copilot' },
    { searchSurface: 'slack' as const, expected: 'slack' },
  ])(
    'attributes organization searches to trusted $expected provenance',
    async ({ searchSurface, expected }) => {
      const result = await searchWorkspaceServerTool.execute(
        { query: 'policy', surface: 'api', searchSurface: 'api' },
        {
          ...context,
          workspaceId: undefined,
          organizationId: 'org-1',
          chatId: 'chat-1',
          requestMode: 'assistant',
          searchSurface,
        }
      )
      expect(result).toMatchObject({ success: true })
      expect(mocks.search).toHaveBeenCalledWith({
        principal: expect.objectContaining({ organizationId: 'org-1', subjectUserId: 'reader' }),
        input: expect.objectContaining({ surface: expected, organizationId: 'org-1' }),
      })
    }
  )

  it('rejects a removed member or another private chat before reading documents', async () => {
    mocks.authorizeChat.mockRejectedValueOnce(new Error('Conversation not found'))
    const result = await readDocumentServerTool.execute(
      { documentId: 'doc' },
      {
        ...context,
        workspaceId: undefined,
        organizationId: 'org-1',
        chatId: 'other-chat',
        requestMode: 'assistant',
      }
    )
    expect(result.success).toBe(false)
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('pins identity and workspace to the trusted turn and retains its search constraints', async () => {
    await searchWorkspaceServerTool.execute(
      { query: 'orion', workspaceId: 'forged', userId: 'other' },
      context
    )
    expect(mocks.search).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: expect.objectContaining({
          kind: 'delegated',
          subjectUserId: 'reader',
          workspaceId: 'workspace',
        }),
        input: expect.objectContaining({
          workspaceId: 'workspace',
          filters: context.assistantSearch,
        }),
      })
    )
  })
  it('returns only the projected query to the model', async () => {
    const secret = 'private-resolved-query-token'
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: secret, encryptedValue: 'ciphertext' },
    ])
    registry.recordResolved('TOKEN', secret)
    const result = await searchWorkspaceServerTool.execute(
      { query: `Find ${secret}` },
      { ...context, resolvedSecretTraceRegistry: registry }
    )
    expect(result).toMatchObject({ success: true, data: { query: 'Find {{TOKEN}}' } })
    expect(mocks.search).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ query: 'Find {{TOKEN}}' }) })
    )
    expect(JSON.stringify(result)).not.toContain(secret)
  })
  it('rejects untrusted contexts, incompatible sources and out-of-scope document reads', async () => {
    expect(
      await searchWorkspaceServerTool.execute(
        { query: 'orion' },
        { ...context, copilotToolExecution: false }
      )
    ).toMatchObject({ success: false })
    expect(
      await searchWorkspaceServerTool.execute({ query: 'orion', source: 'gitlab' }, context)
    ).toMatchObject({ success: false })
    expect(await readDocumentServerTool.execute({ documentId: 'outside' }, context)).toMatchObject({
      success: false,
    })
    expect(mocks.search).not.toHaveBeenCalled()
    expect(mocks.read).not.toHaveBeenCalled()
  })
})
