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
  listAllTags: vi.fn(),
  nextSlot: vi.fn(),
  createTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
  readUsage: vi.fn(),
  saveTags: vi.fn(),
  cleanupTags: vi.fn(),
  deleteAllTags: vi.fn(),
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
  getTagDefinitions: mocks.listAllTags,
  getNextAvailableSlot: mocks.nextSlot,
  createTagDefinition: mocks.createTag,
  updateTagDefinition: mocks.updateTag,
  deleteTagDefinition: mocks.deleteTag,
  getTagUsageStats: mocks.readUsage,
  normalizeDisplayName: (displayName: string) => displayName.trim().toLowerCase(),
  createOrUpdateTagDefinitionsBulk: mocks.saveTags,
  cleanupUnusedTagDefinitions: mocks.cleanupTags,
  deleteAllTagDefinitions: mocks.deleteAllTags,
}))

import {
  createKnowledgeTag,
  deleteKnowledgeDocumentTagDefinitions,
  deleteKnowledgeTag,
  listKnowledgeTags,
  readKnowledgeTagUsage,
  readNextKnowledgeTagSlot,
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
    mocks.listAllTags.mockResolvedValue([])
    mocks.listTags.mockResolvedValue([])
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

  /**
   * The unique index on display name is case-sensitive, so it admits names that
   * differ only in case. Two such tags are indistinguishable in every surface
   * that filters by name.
   */
  it('rejects a create whose display name differs from an existing one only in case', async () => {
    mocks.listTags.mockResolvedValueOnce([
      {
        id: 'tag-1',
        knowledgeBaseId: 'knowledge-b',
        tagSlot: 'tag1',
        displayName: 'clitest-cat',
        fieldType: 'text',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])

    await expect(
      createKnowledgeTag.execute({
        principal: sessionPrincipal,
        input: {
          knowledgeBaseId: 'knowledge-b',
          displayName: 'CLITEST-CAT',
          fieldType: 'text',
        },
      })
    ).rejects.toMatchObject({ code: 'conflict' })

    expect(mocks.createTag).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  /**
   * Neither uniqueness invariant can be checked before the write: the read that
   * would check it and the insert that depends on the answer are separate
   * statements. `tagSlot` is a caller parameter too, so an occupied slot reaches
   * the index on the first try — a 500 for an ordinary well-formed request.
   */
  it.each([
    ['kb_tag_definitions_kb_slot_idx', /slot is already in use/i],
    ['kb_tag_definitions_kb_display_name_idx', /name already exists/i],
  ])('reports a create that loses at %s as a conflict', async (constraint, message) => {
    mocks.createTag.mockRejectedValueOnce(
      Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: '23505',
        constraint_name: constraint,
      })
    )

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
    ).rejects.toMatchObject({ code: 'conflict', message: expect.stringMatching(message) })

    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  /**
   * A tag's slot is fixed, and each slot holds one kind of value. Without this
   * guard a tag sitting in a text slot could be relabelled `number`, and every
   * later read would interpret its text values as the wrong type.
   */
  it.each([
    ['number', 'tag1'],
    ['date', 'tag1'],
  ])('rejects changing fieldType to %s, invalid for the tag slot', async (fieldType, tagSlot) => {
    mocks.resolveTag.mockResolvedValueOnce({
      ...tagContext,
      tagDefinition: { ...tagContext.tagDefinition, tagSlot, fieldType: 'text' },
    })

    await expect(
      updateKnowledgeTag.execute({
        principal: sessionPrincipal,
        input: {
          knowledgeBaseId: 'knowledge-b',
          tagDefinitionId: 'tag-1',
          updates: { fieldType },
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })

    expect(mocks.updateTag).not.toHaveBeenCalled()
  })

  it('rejects an unknown fieldType on update, as create does', async () => {
    await expect(
      updateKnowledgeTag.execute({
        principal: sessionPrincipal,
        input: {
          knowledgeBaseId: 'knowledge-b',
          tagDefinitionId: 'tag-1',
          updates: { fieldType: 'nonsense' },
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.updateTag).not.toHaveBeenCalled()
  })

  it('allows a rename that leaves the field type alone', async () => {
    mocks.updateTag.mockResolvedValueOnce({ ...tagContext.tagDefinition, displayName: 'Region' })

    await updateKnowledgeTag.execute({
      principal: sessionPrincipal,
      input: {
        knowledgeBaseId: 'knowledge-b',
        tagDefinitionId: 'tag-1',
        updates: { displayName: 'Region' },
      },
    })

    expect(mocks.updateTag).toHaveBeenCalledTimes(1)
  })

  /**
   * The display-name index is case-sensitive, so it admits on rename exactly the
   * pair create rejects.
   */
  it('rejects a rename whose display name differs from an existing one only in case', async () => {
    mocks.listTags.mockResolvedValueOnce([
      {
        id: 'tag-other',
        knowledgeBaseId: 'knowledge-b',
        tagSlot: 'tag2',
        displayName: 'clitest-cat',
        fieldType: 'text',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])

    await expect(
      updateKnowledgeTag.execute({
        principal: sessionPrincipal,
        input: {
          knowledgeBaseId: 'knowledge-b',
          tagDefinitionId: 'tag-b',
          updates: { displayName: 'CLITEST-CAT' },
        },
      })
    ).rejects.toMatchObject({ code: 'conflict' })

    expect(mocks.updateTag).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  /** Re-casing a tag's own name is not a collision with itself. */
  it('allows a tag to be renamed to a different casing of its own name', async () => {
    mocks.listTags.mockResolvedValueOnce([
      {
        id: 'tag-b',
        knowledgeBaseId: 'knowledge-b',
        tagSlot: 'tag1',
        displayName: 'Region',
        fieldType: 'text',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])
    mocks.updateTag.mockResolvedValueOnce({ ...tagContext.tagDefinition, displayName: 'region' })

    await updateKnowledgeTag.execute({
      principal: sessionPrincipal,
      input: {
        knowledgeBaseId: 'knowledge-b',
        tagDefinitionId: 'tag-b',
        updates: { displayName: 'region' },
      },
    })

    expect(mocks.updateTag).toHaveBeenCalledTimes(1)
  })

  it('reports a rename onto a taken name as a conflict', async () => {
    mocks.updateTag.mockRejectedValueOnce(
      Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: '23505',
        constraint_name: 'kb_tag_definitions_kb_display_name_idx',
      })
    )

    await expect(
      updateKnowledgeTag.execute({
        principal: sessionPrincipal,
        input: {
          knowledgeBaseId: 'knowledge-b',
          tagDefinitionId: 'tag-1',
          updates: { displayName: 'Region' },
        },
      })
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  /** A not-null or foreign-key violation is a real fault and must stay one. */
  it('propagates a non-uniqueness database failure', async () => {
    mocks.createTag.mockRejectedValueOnce(
      Object.assign(new Error('null value in column violates not-null constraint'), {
        code: '23502',
      })
    )

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
    ).rejects.toThrow('not-null constraint')
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

  /**
   * `TAG_SLOT_CONFIG` gives text 7 slots but number 5, boolean 3, and date 2, so
   * a fixed total of 7 reported free capacity a narrower field type does not
   * have — `number` with four slots taken read as three remaining when one did.
   */
  it.each([
    ['text', 7],
    ['number', 5],
    ['boolean', 3],
    ['date', 2],
  ] as const)(
    'reports %s capacity from its own slot table, not the text one',
    async (fieldType, maxSlots) => {
      mocks.listAllTags.mockResolvedValue([
        { tagSlot: `${fieldType}-slot-1`, fieldType },
        { tagSlot: `${fieldType}-slot-2`, fieldType },
        { tagSlot: 'tag7', fieldType: 'text-other' },
      ])
      mocks.nextSlot.mockResolvedValue(`${fieldType}-slot-3`)

      await expect(
        readNextKnowledgeTagSlot.execute({
          principal: sessionPrincipal,
          input: { knowledgeBaseId: 'knowledge-b', fieldType },
        })
      ).resolves.toEqual({
        nextAvailableSlot: `${fieldType}-slot-3`,
        fieldType,
        usedSlots: [`${fieldType}-slot-1`, `${fieldType}-slot-2`],
        totalSlots: maxSlots,
        availableSlots: maxSlots - 2,
      })
    }
  )

  it('reports no capacity once the field type is exhausted', async () => {
    mocks.listAllTags.mockResolvedValue([{ tagSlot: 'date1', fieldType: 'date' }])
    mocks.nextSlot.mockResolvedValue(null)

    await expect(
      readNextKnowledgeTagSlot.execute({
        principal: sessionPrincipal,
        input: { knowledgeBaseId: 'knowledge-b', fieldType: 'date' },
      })
    ).resolves.toMatchObject({ totalSlots: 2, availableSlots: 0 })
  })

  /**
   * Both vocabulary writes act on the knowledge base: the bulk save writes
   * `knowledge_base_tag_definitions` keyed by base and slot, and the cleanup
   * deletes definitions across every document in the base. Neither reads a
   * document, so neither resolves one — the canonical context they load is the
   * knowledge base, and their audit entry names it.
   */
  it('resolves the knowledge base rather than a document for a bulk save', async () => {
    mocks.saveTags.mockResolvedValue({ created: [], updated: [], errors: [] })

    await saveKnowledgeDocumentTagDefinitions.execute({
      principal: sessionPrincipal,
      input: {
        knowledgeBaseId: 'knowledge-b',
        definitions: [{ tagSlot: 'tag1', displayName: 'Region', fieldType: 'text' }],
      },
    })

    expect(mocks.resolveKnowledgeBase).toHaveBeenCalledWith(
      expect.objectContaining({ knowledgeBaseId: 'knowledge-b' })
    )
    expect(mocks.resolveDocument).not.toHaveBeenCalled()
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ resourceType: 'knowledge_base', resourceId: 'knowledge-b' })
    )
  })

  it('cleans unused definitions across the knowledge base without resolving a document', async () => {
    mocks.cleanupTags.mockResolvedValue(3)

    await expect(
      deleteKnowledgeDocumentTagDefinitions.execute({
        principal: sessionPrincipal,
        input: { knowledgeBaseId: 'knowledge-b', action: 'cleanup' },
      })
    ).resolves.toEqual({ action: 'cleanup', count: 3 })

    expect(mocks.cleanupTags).toHaveBeenCalledWith('knowledge-b', expect.any(String))
    expect(mocks.resolveDocument).not.toHaveBeenCalled()
  })

  it('deletes the whole vocabulary when the caller asks for all', async () => {
    mocks.deleteAllTags.mockResolvedValue(7)

    await expect(
      deleteKnowledgeDocumentTagDefinitions.execute({
        principal: sessionPrincipal,
        input: { knowledgeBaseId: 'knowledge-b', action: 'all' },
      })
    ).resolves.toEqual({ action: 'all', count: 7 })

    expect(mocks.cleanupTags).not.toHaveBeenCalled()
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
