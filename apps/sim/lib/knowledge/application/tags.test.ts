/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveKnowledgeBase: vi.fn(),
  resolveTag: vi.fn(),
  resolveDocument: vi.fn(),
  resolvePermission: vi.fn(),
  listTags: vi.fn(),
  nextSlot: vi.fn(),
  createTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
  readUsage: vi.fn(),
  saveTags: vi.fn(),
  recordAudit: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { KNOWLEDGE_BASE_UPDATED: 'knowledge_base.updated' },
  AuditResourceType: { KNOWLEDGE_BASE: 'knowledge_base' },
  recordAudit: mocks.recordAudit,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveActiveKnowledgeBaseContext: mocks.resolveKnowledgeBase,
  resolveActiveKnowledgeResourceContext: mocks.resolveKnowledgeBase,
  resolveActiveKnowledgeTagContext: mocks.resolveTag,
  resolveCanonicalActiveKnowledgeDocumentContext: mocks.resolveDocument,
}))

vi.mock('@/lib/knowledge/tags/service', () => ({
  getDocumentTagDefinitions: mocks.listTags,
  getNextAvailableSlot: mocks.nextSlot,
  createTagDefinition: mocks.createTag,
  updateTagDefinition: mocks.updateTag,
  deleteTagDefinition: mocks.deleteTag,
  getTagUsageStats: mocks.readUsage,
  createOrUpdateTagDefinitionsBulk: mocks.saveTags,
}))

import {
  createKnowledgeTag,
  deleteKnowledgeTag,
  listKnowledgeTags,
  readKnowledgeTagUsage,
  saveKnowledgeDocumentTagDefinitions,
  updateKnowledgeTag,
} from '@/lib/knowledge/application/tags'

const crossWorkspaceContext = {
  workspaceId: 'workspace-b',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-b',
  knowledgeBaseId: 'knowledge-b',
  knowledgeBase: { id: 'knowledge-b', name: 'Workspace B docs' },
}

const tagContext = {
  ...crossWorkspaceContext,
  tagDefinitionId: 'tag-b',
  tagDefinition: {
    id: 'tag-b',
    knowledgeBaseId: 'knowledge-b',
    tagSlot: 'tag1',
    displayName: 'Region',
    fieldType: 'text',
  },
}

const documentContext = {
  ...crossWorkspaceContext,
  documentId: 'document-b',
  document: {
    id: 'document-b',
    knowledgeBaseId: 'knowledge-b',
    filename: 'customers.csv',
  },
}

const sessionPrincipal = {
  kind: 'session' as const,
  userId: 'user-1',
  sessionId: 'session-1',
}

const delegatedPrincipal = {
  kind: 'delegated' as const,
  serviceId: 'copilot',
  subjectUserId: 'shared-user',
  workspaceId: 'workspace-a',
  delegationId: 'tool-call-1',
  audience: 'sim:knowledge',
  issuedAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
  resourceScope: {},
}

describe('knowledge tag application use cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.resolveKnowledgeBase.mockResolvedValue(crossWorkspaceContext)
    mocks.resolveTag.mockResolvedValue(tagContext)
    mocks.resolveDocument.mockResolvedValue(documentContext)
    mocks.saveTags.mockResolvedValue({ created: [], updated: [], errors: [] })
  })

  it.each([
    [
      'list',
      listKnowledgeTags,
      { knowledgeBaseId: 'knowledge-b', assertedWorkspaceId: 'workspace-a' },
    ],
    [
      'create',
      createKnowledgeTag,
      {
        knowledgeBaseId: 'knowledge-b',
        assertedWorkspaceId: 'workspace-a',
        displayName: 'Region',
      },
    ],
    [
      'update',
      updateKnowledgeTag,
      {
        tagDefinitionId: 'tag-b',
        assertedWorkspaceId: 'workspace-a',
        updates: { displayName: 'Market' },
      },
    ],
    [
      'delete',
      deleteKnowledgeTag,
      {
        knowledgeBaseId: 'knowledge-b',
        tagDefinitionId: 'tag-b',
        assertedWorkspaceId: 'workspace-a',
      },
    ],
    [
      'read usage',
      readKnowledgeTagUsage,
      { knowledgeBaseId: 'knowledge-b', assertedWorkspaceId: 'workspace-a' },
    ],
  ])(
    'rejects cross-workspace %s before current membership or tag work',
    async (_name, useCase, input) => {
      await expect(useCase.execute({ principal: delegatedPrincipal, input })).rejects.toMatchObject(
        {
          name: 'DelegatedWorkspaceAuthorizationError',
          code: 'forbidden',
        }
      )

      expect(mocks.resolvePermission).not.toHaveBeenCalled()
      expect(mocks.listTags).not.toHaveBeenCalled()
      expect(mocks.nextSlot).not.toHaveBeenCalled()
      expect(mocks.createTag).not.toHaveBeenCalled()
      expect(mocks.updateTag).not.toHaveBeenCalled()
      expect(mocks.deleteTag).not.toHaveBeenCalled()
      expect(mocks.readUsage).not.toHaveBeenCalled()
      expect(mocks.recordAudit).not.toHaveBeenCalled()
    }
  )

  it('authorizes current delegated membership before mutation and records semantic audit', async () => {
    const sameWorkspaceContext = {
      ...tagContext,
      workspaceId: 'workspace-a',
      knowledgeBaseId: 'knowledge-a',
      knowledgeBase: { id: 'knowledge-a', name: 'Workspace A docs' },
      tagDefinition: { ...tagContext.tagDefinition, knowledgeBaseId: 'knowledge-a' },
    }
    const updatedTag = { ...sameWorkspaceContext.tagDefinition, displayName: 'Market' }
    mocks.resolveTag.mockResolvedValueOnce(sameWorkspaceContext)
    mocks.updateTag.mockResolvedValueOnce(updatedTag)

    const result = await updateKnowledgeTag.execute({
      principal: delegatedPrincipal,
      input: {
        tagDefinitionId: 'tag-b',
        assertedWorkspaceId: 'workspace-a',
        updates: { displayName: 'Market' },
        source: 'agent',
      },
    })

    expect(result.tagDefinition).toEqual(updatedTag)
    expect(mocks.resolvePermission).toHaveBeenCalledWith(
      'shared-user',
      'workspace-a',
      null,
      undefined,
      { forUpdate: undefined }
    )
    expect(mocks.resolvePermission.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateTag.mock.invocationCallOrder[0]
    )
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-a',
        action: 'knowledge_base.updated',
        metadata: expect.objectContaining({
          operation: 'knowledge.tags.update',
          change: 'tag_updated',
          actor: expect.objectContaining({ kind: 'delegated', serviceId: 'copilot' }),
        }),
      })
    )
  })

  it.each([
    ['an unknown slot', { tagSlot: 'tag99', fieldType: 'text' }],
    ['a slot reserved for another field type', { tagSlot: 'number1', fieldType: 'text' }],
  ])('rejects create with %s before persistence', async (_description, slotInput) => {
    await expect(
      createKnowledgeTag.execute({
        principal: sessionPrincipal,
        input: {
          knowledgeBaseId: 'knowledge-b',
          displayName: 'Region',
          ...slotInput,
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })

    expect(mocks.createTag).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('accepts a create slot matching its field type', async () => {
    const tagDefinition = { ...tagContext.tagDefinition, id: 'tag-new' }
    mocks.createTag.mockResolvedValueOnce(tagDefinition)

    await expect(
      createKnowledgeTag.execute({
        principal: sessionPrincipal,
        input: {
          knowledgeBaseId: 'knowledge-b',
          tagSlot: 'tag1',
          displayName: 'Region',
          fieldType: 'text',
        },
      })
    ).resolves.toEqual({ tagDefinition, knowledgeBaseId: 'knowledge-b' })

    expect(mocks.createTag).toHaveBeenCalledWith(
      {
        knowledgeBaseId: 'knowledge-b',
        tagSlot: 'tag1',
        displayName: 'Region',
        fieldType: 'text',
      },
      expect.any(String)
    )
  })

  it.each([
    ['an unsupported field type', { tagSlot: 'tag1', fieldType: 'nonsense' }],
    ['an unknown slot', { tagSlot: 'tag99', fieldType: 'text' }],
  ])('rejects bulk save with %s before persistence', async (_description, definition) => {
    await expect(
      saveKnowledgeDocumentTagDefinitions.execute({
        principal: sessionPrincipal,
        input: {
          knowledgeBaseId: 'knowledge-b',
          documentId: 'document-b',
          definitions: [{ ...definition, displayName: 'Region' }],
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })

    expect(mocks.saveTags).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('preserves legacy bulk rename payloads whose existing slot and field type differ', async () => {
    const definitions = [
      {
        tagSlot: 'number1',
        displayName: 'Customer region',
        originalDisplayName: 'Region',
        fieldType: 'text',
      },
    ]

    await expect(
      saveKnowledgeDocumentTagDefinitions.execute({
        principal: sessionPrincipal,
        input: {
          knowledgeBaseId: 'knowledge-b',
          documentId: 'document-b',
          definitions,
        },
      })
    ).resolves.toEqual({ created: [], updated: [], errors: [] })

    expect(mocks.saveTags).toHaveBeenCalledWith('knowledge-b', { definitions }, expect.any(String))
  })
})
