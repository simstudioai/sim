import type { Principal } from '@sim/auth/principal'
import {
  createDelegatedPrincipal,
  createSessionPrincipal,
} from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import {
  knowledgeContextsMock,
  knowledgeContextsMockFns,
} from '@sim/testing/mocks/knowledge-contexts.mock'
import {
  knowledgeTagsServiceMock,
  knowledgeTagsServiceMockFns,
} from '@sim/testing/mocks/knowledge-tags-service.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/audit', () => auditMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/knowledge/application/contexts', () => knowledgeContextsMock)

vi.mock('@/lib/knowledge/tags/service', () => knowledgeTagsServiceMock)

const admission = vi.hoisted(() => ({ admitKnowledgeDocuments: vi.fn() }))
vi.mock('@/lib/knowledge/application/admit-knowledge-content', () => admission)

import { admitContent } from '@/lib/core/application'
import { WORKSPACE_ACCESS_SCOPE } from '@/lib/knowledge/access/scope'
import {
  createKnowledgeTag,
  deleteKnowledgeTag,
  listKnowledgeTags,
  readDetailedKnowledgeTagUsage,
  readKnowledgeTagUsage,
  readNextKnowledgeTagSlot,
  updateKnowledgeTag,
} from '@/lib/knowledge/application/tags'

knowledgeContextsMockFns.mockResolveActiveKnowledgeResourceContext.mockImplementation(
  (...args: unknown[]) => knowledgeContextsMockFns.mockResolveActiveKnowledgeBaseContext(...args)
)

/** Every mocked context carries the workspace read scope the resolvers would attach. */
const knowledgeAccess = {
  get: async () => WORKSPACE_ACCESS_SCOPE,
  getForConnectors: async () => WORKSPACE_ACCESS_SCOPE,
  getForDocuments: async () => WORKSPACE_ACCESS_SCOPE,
}

const crossWorkspaceContext = {
  access: knowledgeAccess,
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

const sessionPrincipal = createSessionPrincipal()

const delegatedPrincipal = createDelegatedPrincipal({
  subjectUserId: 'shared-user',
  workspaceId: 'workspace-a',
  delegationId: 'tool-call-1',
  audience: 'sim:knowledge',
  resourceScope: {},
})

const mocks = {
  listTags: knowledgeTagsServiceMockFns.mockGetDocumentTagDefinitions,
  listAllTags: knowledgeTagsServiceMockFns.mockGetTagDefinitions,
  nextSlot: knowledgeTagsServiceMockFns.mockGetNextAvailableSlot,
  createTag: knowledgeTagsServiceMockFns.mockCreateTagDefinition,
  updateTag: knowledgeTagsServiceMockFns.mockUpdateTagDefinition,
  deleteTag: knowledgeTagsServiceMockFns.mockDeleteTagDefinition,
  readUsage: knowledgeTagsServiceMockFns.mockGetTagUsageStats,
  readDetailedUsage: knowledgeTagsServiceMockFns.mockGetTagUsage,
  saveTags: knowledgeTagsServiceMockFns.mockCreateOrUpdateTagDefinitionsBulk,
  cleanupTags: knowledgeTagsServiceMockFns.mockCleanupUnusedTagDefinitions,
  deleteAllTags: knowledgeTagsServiceMockFns.mockDeleteAllTagDefinitions,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  recordAudit: auditMockFns.mockRecordAudit,
  resolveKnowledgeBase: knowledgeContextsMockFns.mockResolveActiveKnowledgeBaseContext,
  resolveTag: knowledgeContextsMockFns.mockResolveActiveKnowledgeTagContext,
  resolveDocument: knowledgeContextsMockFns.mockResolveCanonicalActiveKnowledgeDocumentContext,
}

describe('knowledge tag application use cases', () => {
  beforeEach(() => {
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.resolveKnowledgeBase.mockResolvedValue(crossWorkspaceContext)
    mocks.resolveTag.mockResolvedValue(tagContext)
    mocks.resolveDocument.mockResolvedValue(documentContext)
    mocks.saveTags.mockResolvedValue({ created: [], updated: [], errors: [] })
    mocks.listAllTags.mockResolvedValue([])
    mocks.listTags.mockResolvedValue([])
  })

  it.each([
    {
      name: 'list',
      run: () =>
        listKnowledgeTags.execute({
          principal: delegatedPrincipal,
          input: { knowledgeBaseId: 'knowledge-b', assertedWorkspaceId: 'workspace-a' },
        }),
    },
    {
      name: 'create',
      run: () =>
        createKnowledgeTag.execute({
          principal: delegatedPrincipal,
          input: {
            knowledgeBaseId: 'knowledge-b',
            assertedWorkspaceId: 'workspace-a',
            displayName: 'Region',
          },
        }),
    },
    {
      name: 'update',
      run: () =>
        updateKnowledgeTag.execute({
          principal: delegatedPrincipal,
          input: {
            tagDefinitionId: 'tag-b',
            assertedWorkspaceId: 'workspace-a',
            updates: { displayName: 'Market' },
          },
        }),
    },
    {
      name: 'delete',
      run: () =>
        deleteKnowledgeTag.execute({
          principal: delegatedPrincipal,
          input: {
            knowledgeBaseId: 'knowledge-b',
            tagDefinitionId: 'tag-b',
            assertedWorkspaceId: 'workspace-a',
          },
        }),
    },
    {
      name: 'read usage',
      run: () =>
        readKnowledgeTagUsage.execute({
          principal: delegatedPrincipal,
          input: { knowledgeBaseId: 'knowledge-b', assertedWorkspaceId: 'workspace-a' },
        }),
    },
  ])('rejects cross-workspace $name before current membership or tag work', async ({ run }) => {
    await expect(run()).rejects.toMatchObject({
      name: 'DelegatedWorkspaceAuthorizationError',
      code: 'forbidden',
    })

    expect(mocks.resolvePermission).not.toHaveBeenCalled()
    expect(mocks.listTags).not.toHaveBeenCalled()
    expect(mocks.nextSlot).not.toHaveBeenCalled()
    expect(mocks.createTag).not.toHaveBeenCalled()
    expect(mocks.updateTag).not.toHaveBeenCalled()
    expect(mocks.deleteTag).not.toHaveBeenCalled()
    expect(mocks.readUsage).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
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

  describe('tag usage Chat may see', () => {
    const chat = { ...delegatedPrincipal, workspaceId: 'workspace-b' }
    /** One document under two definitions: its value is refused under one and admitted under the other. */
    const detailed = [
      {
        tagName: 'Region',
        tagSlot: 'tag1',
        documentCount: 2,
        documents: [
          { id: 'doc-shared', name: 'shared.csv', tagValue: 'refused' },
          { id: 'doc-other', name: 'other.csv', tagValue: 'emea' },
        ],
      },
      {
        tagName: 'Owner',
        tagSlot: 'tag2',
        documentCount: 1,
        documents: [{ id: 'doc-shared', name: 'shared.csv', tagValue: 'ops' }],
      },
    ]

    beforeEach(() => {
      mocks.resolvePermission.mockResolvedValue('read')
      mocks.readDetailedUsage.mockResolvedValue(detailed)
      /** Stands in for the gate: refuses an occurrence by the value it shows. */
      admission.admitKnowledgeDocuments.mockImplementation(
        async (principal: Principal, documents: { id: string; value: { tagValue: string } }[]) => {
          await admitContent(principal, [])
          return new Set(
            documents.filter((doc) => doc.value.tagValue !== 'refused').map((doc) => doc.id)
          )
        }
      )
    })

    it('answers Chat an empty usage for a base with no tag definitions', async () => {
      mocks.readDetailedUsage.mockResolvedValue([])
      await expect(
        readDetailedKnowledgeTagUsage.execute({
          principal: chat,
          input: { knowledgeBaseId: 'knowledge-b' },
        })
      ).resolves.toMatchObject({ usage: [] })
      expect(admission.admitKnowledgeDocuments).not.toHaveBeenCalled()
    })

    it('binds each occurrence to the stored tag value it shows', async () => {
      await readDetailedKnowledgeTagUsage.execute({
        principal: chat,
        input: { knowledgeBaseId: 'knowledge-b' },
      })
      const [, documents] = admission.admitKnowledgeDocuments.mock.calls[1]
      expect(documents).toEqual([
        expect.objectContaining({
          id: 'doc-shared',
          snapshot: { filename: 'shared.csv', tag2: 'ops' },
        }),
      ])
    })

    it('decides each (definition, document) occurrence on its own', async () => {
      const result = await readDetailedKnowledgeTagUsage.execute({
        principal: chat,
        input: { knowledgeBaseId: 'knowledge-b' },
      })

      expect(result.usage[0]).toMatchObject({
        documentCount: 1,
        documents: [{ id: 'doc-other' }],
      })
      expect(result.usage[1]).toBe(detailed[1])
    })

    it('leaves a person’s counts as stored, without reading documents', async () => {
      const stats = [
        {
          id: 'def-1',
          tagSlot: 'tag1',
          displayName: 'Region',
          fieldType: 'text',
          documentCount: 2,
          chunkCount: 9,
        },
      ]
      mocks.readUsage.mockResolvedValue(stats)

      const result = await readKnowledgeTagUsage.execute({
        principal: sessionPrincipal,
        input: { knowledgeBaseId: 'knowledge-b' },
      })

      expect(result.usage).toBe(stats)
      expect(mocks.readDetailedUsage).not.toHaveBeenCalled()
    })
  })
})
