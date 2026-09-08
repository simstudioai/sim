/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ search: vi.fn(), read: vi.fn(), authorizeChat: vi.fn() }))
vi.mock('@/lib/copilot/chat/organization-chats', () => ({
  authorizeOrganizationChatDelegation: { execute: mocks.authorizeChat },
}))
vi.mock('@/lib/knowledge/application/workspace-search', () => ({
  searchOrganizationKnowledge: {
    get operation() {
      return knowledgeOperations.search
    },
    execute: mocks.search,
  },
  searchWorkspaceKnowledge: {
    get operation() {
      return knowledgeOperations.search
    },
    execute: mocks.search,
  },
}))
vi.mock('@/lib/knowledge/application/read-search-document', () => ({
  readSearchDocument: {
    get operation() {
      return knowledgeOperations.readDocument
    },
    execute: mocks.read,
  },
}))
vi.mock('@/executor/utils/resolved-secret-content-projection', () => ({
  projectResolvedSecretModelContent: (value: unknown) => ({ safe: true, value }),
}))

import {
  readDocumentServerTool,
  searchWorkspaceServerTool,
} from '@/lib/copilot/tools/server/knowledge/workspace-search'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

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
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.search.mockResolvedValue({
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
    })
    mocks.read.mockResolvedValue({
      knowledgeBaseId: 'index',
      documentId: 'doc',
      documentName: 'Title',
      sourceUrl: 'https://source.test/doc',
      chunks: [{ content: 'body', chunkIndex: 0 }],
      hasMore: false,
      nextOffset: null,
    })
  })
  it('pins organization and private chat while reusing the canonical search index and citations', async () => {
    const orgContext = {
      ...context,
      workspaceId: undefined,
      organizationId: 'org-1',
      chatId: 'chat-1',
      requestMode: 'assistant',
    }
    const result = await searchWorkspaceServerTool.execute(
      { query: 'policy', organizationId: 'forged' },
      orgContext
    )
    expect(result).toMatchObject({
      success: true,
      data: {
        results: [
          expect.objectContaining({
            citationUrl: expect.stringContaining('/o/org-1/knowledge/index/doc'),
          }),
        ],
      },
    })
    expect(mocks.authorizeChat).toHaveBeenCalledWith({
      principal: expect.objectContaining({
        kind: 'organization_delegated',
        subjectUserId: 'reader',
        organizationId: 'org-1',
        resourceScope: { chatId: 'chat-1' },
      }),
    })
    expect(mocks.search).toHaveBeenCalledWith({
      principal: expect.objectContaining({ organizationId: 'org-1' }),
      input: expect.objectContaining({ organizationId: 'org-1', filters: context.assistantSearch }),
    })
    await readDocumentServerTool.execute({ documentId: 'doc' }, orgContext)
    expect(mocks.read).toHaveBeenCalledWith({
      principal: expect.objectContaining({ organizationId: 'org-1' }),
      input: expect.objectContaining({ assertedOrganizationId: 'org-1' }),
    })
  })

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
  it('returns stable citation IDs with internal links for uploaded documents', async () => {
    const result = await searchWorkspaceServerTool.execute({ query: 'orion' }, context)
    expect(result).toMatchObject({
      success: true,
      data: {
        results: [
          expect.objectContaining({
            citationId: 'document:doc',
            citationUrl: expect.stringContaining('/workspace/workspace/knowledge/index/doc'),
          }),
        ],
      },
    })
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
  it('reads a selected document through the shared use case and rejects unbounded pages', async () => {
    expect(
      await readDocumentServerTool.execute({ documentId: 'doc', offset: 20 }, context)
    ).toMatchObject({ success: true })
    expect(mocks.read).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          assertedWorkspaceId: 'workspace',
          filters: context.assistantSearch,
          offset: 20,
          limit: 20,
        }),
      })
    )
    expect(
      await readDocumentServerTool.execute({ documentId: 'doc', limit: 10000 }, context)
    ).toMatchObject({ success: false })
    expect(mocks.read).toHaveBeenCalledOnce()
  })
})
