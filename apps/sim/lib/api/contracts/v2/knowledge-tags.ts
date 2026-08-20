import { z } from 'zod'
import { knowledgeTagParamsSchema } from '@/lib/api/contracts/knowledge/shared'
import { noInputSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v2KnowledgeBaseParamsSchema,
  v2KnowledgeDocumentParamsSchema,
  v2KnowledgeTagSchema,
} from '@/lib/api/contracts/v2/knowledge'
import { v2CursorListResponse, v2DataResponse } from '@/lib/api/contracts/v2/shared'
import {
  ALL_TAG_SLOTS,
  KNOWLEDGE_TAG_DISPLAY_NAME_MAX_LENGTH,
  MAX_TAG_SLOTS,
  SUPPORTED_FIELD_TYPES,
  TAG_SLOT_CONFIG,
} from '@/lib/knowledge/constants'

/**
 * v2 knowledge tag-definition writes.
 *
 * The read half (`GET /api/v2/knowledge/{id}/tags`) shipped first, which left
 * the tag loop unbuildable end-to-end: a caller could set a tag *value* by slot
 * on a document, but had no way to name that slot, and both the document-list
 * and search tag filters resolve by display name and reject a name no
 * definition declares. These operations close it — create a definition, write
 * its slot on a document, then filter by its display name.
 *
 * Definitions are addressed by id. The slot is where the value is stored and
 * the display name is how it is filtered; neither is a stable identifier, since
 * a display name is unique only per knowledge base and may be renamed.
 */

const fieldTypeValues = SUPPORTED_FIELD_TYPES as [string, ...string[]]

/**
 * Field type on a write. An enum here, unlike on the response, because an input
 * set can be closed at the boundary: both write paths already reject anything
 * outside it in the domain, so publishing the enum only moves that refusal to a
 * 400 that names the valid set.
 */
const v2KnowledgeTagFieldTypeSchema = z
  .enum(fieldTypeValues, {
    error: `fieldType: expected one of ${fieldTypeValues.map((type) => `"${type}"`).join(' | ')}`,
  })
  .describe(
    `Value type stored in the slot; it decides which slots are usable and which filter operators apply. Slot capacity per type: ${SUPPORTED_FIELD_TYPES.map(
      (type) => `${type} ${TAG_SLOT_CONFIG[type].maxSlots}`
    ).join(', ')}.`
  )
  .meta({ examples: ['text'] })

const v2KnowledgeTagSlotSchema = z
  .enum(ALL_TAG_SLOTS, {
    error: `tagSlot: expected one of ${ALL_TAG_SLOTS.map((slot) => `"${slot}"`).join(' | ')}`,
  })
  .describe('Storage slot the tag occupies. It must belong to the tag’s `fieldType`.')
  .meta({ examples: ['tag1'] })

const v2KnowledgeTagDisplayNameSchema = z
  .string()
  .trim()
  .min(1, 'displayName cannot be empty')
  .max(
    KNOWLEDGE_TAG_DISPLAY_NAME_MAX_LENGTH,
    `displayName cannot exceed ${KNOWLEDGE_TAG_DISPLAY_NAME_MAX_LENGTH} characters`
  )
  .describe('Name tag filters and document reads use for this tag.')
  .meta({ examples: ['category'] })

export const v2KnowledgeTagParamsSchema = knowledgeTagParamsSchema.extend({
  id: knowledgeTagParamsSchema.shape.id.describe('Unique knowledge base identifier.'),
  tagId: knowledgeTagParamsSchema.shape.tagId.describe('Unique tag definition identifier.'),
})
export type V2KnowledgeTagParams = z.output<typeof v2KnowledgeTagParamsSchema>

const v2KnowledgeWorkspaceQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the knowledge base.'),
  })
  .strict()

/**
 * `tagSlot` is optional: omitting it assigns the next free slot for the field
 * type, which is what a caller that does not care about storage layout wants.
 * Exhausting the type's slots is a `400` naming the type — the remedy is
 * choosing a different `fieldType` or deleting a definition, not retrying.
 */
export const v2CreateKnowledgeTagBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the knowledge base.'),
    displayName: v2KnowledgeTagDisplayNameSchema,
    fieldType: v2KnowledgeTagFieldTypeSchema.optional().default('text'),
    tagSlot: v2KnowledgeTagSlotSchema
      .optional()
      .describe(
        'Slot to store the tag in. Omit to take the next free slot for the field type; a slot that does not belong to the field type, or one already in use, is rejected.'
      ),
  })
  .strict()
export type V2CreateKnowledgeTagBody = z.input<typeof v2CreateKnowledgeTagBodySchema>

export const v2UpdateKnowledgeTagBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the knowledge base.'),
    displayName: v2KnowledgeTagDisplayNameSchema.optional().describe('New tag display name.'),
    fieldType: v2KnowledgeTagFieldTypeSchema.optional().describe('New value type for the tag.'),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.displayName === undefined && body.fieldType === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['displayName'],
        message: 'At least one of displayName or fieldType is required',
      })
    }
  })
export type V2UpdateKnowledgeTagBody = z.input<typeof v2UpdateKnowledgeTagBodySchema>

/**
 * Deleting a definition also clears the slot's values on every document and
 * chunk in the knowledge base — the definition is what gives the slot meaning,
 * so leaving the values would strand them under a raw slot name.
 */
export const v2DeleteKnowledgeTagDataSchema = z
  .object({
    id: z.string().describe('Identifier of the deleted tag definition.'),
    tagSlot: z.string().describe('Slot the deleted tag occupied; its values are now cleared.'),
    displayName: z.string().describe('Display name the deleted tag carried.'),
    deleted: z.literal(true).describe('Confirms that the tag definition was deleted.'),
  })
  .strict()
  .meta({
    id: 'V2DeleteKnowledgeTagData',
    title: 'Delete knowledge tag data',
    description: 'Acknowledgement for a deleted tag definition.',
  })

export const v2NextKnowledgeTagSlotQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the knowledge base.'),
    fieldType: v2KnowledgeTagFieldTypeSchema,
  })
  .strict()
export type V2NextKnowledgeTagSlotQuery = z.output<typeof v2NextKnowledgeTagSlotQuerySchema>

export const v2NextKnowledgeTagSlotDataSchema = z
  .object({
    nextAvailableSlot: z
      .string()
      .nullable()
      .describe('The free slot a create would take, or null when the field type is exhausted.')
      .meta({ examples: ['tag3'] }),
    fieldType: z.string().describe('Field type the slots were counted for.'),
    usedSlots: z.array(z.string()).describe('Slots of this field type already holding a tag.'),
    totalSlots: z
      .number()
      .int()
      .positive()
      .describe(
        `Slot table size used for the counts below. Always ${MAX_TAG_SLOTS}, the text-slot count, so it can exceed the real capacity of a narrower field type.`
      ),
    availableSlots: z
      .number()
      .int()
      .nonnegative()
      .describe('Remaining slots, or 0 when the field type is exhausted.'),
  })
  .strict()
  .meta({
    id: 'V2NextKnowledgeTagSlotData',
    title: 'Next knowledge tag slot',
    description: 'Slot availability for one tag field type.',
  })

export const v2KnowledgeTagUsageSchema = z
  .object({
    tagSlot: z
      .string()
      .describe('Slot the tag occupies.')
      .meta({ examples: ['tag1'] }),
    displayName: z
      .string()
      .describe('Tag display name.')
      .meta({ examples: ['category'] }),
    fieldType: z
      .string()
      .describe('Value type stored in the slot.')
      .meta({ examples: ['text'] }),
    documentCount: z
      .number()
      .int()
      .nonnegative()
      .describe('Documents in the knowledge base carrying a value in this slot.'),
    chunkCount: z
      .number()
      .int()
      .nonnegative()
      .describe('Indexed chunks carrying a value in this slot.'),
  })
  .strict()
  .meta({
    id: 'V2KnowledgeTagUsage',
    title: 'Knowledge tag usage',
    description: 'How widely one tag is populated across a knowledge base.',
  })

/**
 * A tag definition a document write declares.
 *
 * `originalDisplayName` names the definition being renamed. It is how a bulk
 * save distinguishes "rename the tag in this slot" from "define a new one", and
 * a slot already holding a definition under a different name is updated rather
 * than duplicated.
 */
export const v2SaveKnowledgeDocumentTagDefinitionSchema = z
  .object({
    tagSlot: v2KnowledgeTagSlotSchema,
    displayName: v2KnowledgeTagDisplayNameSchema,
    fieldType: v2KnowledgeTagFieldTypeSchema,
    originalDisplayName: v2KnowledgeTagDisplayNameSchema
      .optional()
      .describe('Previous display name, when this entry renames an existing definition.'),
  })
  .strict()
  .meta({
    id: 'V2SaveKnowledgeDocumentTagDefinition',
    title: 'Knowledge document tag definition input',
    description: 'One tag definition declared while saving a document’s tags.',
  })

export const v2SaveKnowledgeDocumentTagDefinitionsBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the knowledge base.'),
    definitions: z
      .array(v2SaveKnowledgeDocumentTagDefinitionSchema)
      .min(1, 'definitions must contain at least one tag definition')
      .max(
        ALL_TAG_SLOTS.length,
        `definitions cannot contain more than ${ALL_TAG_SLOTS.length} entries — one per slot`
      )
      .describe('Tag definitions to create or update on the knowledge base.'),
  })
  .strict()
export type V2SaveKnowledgeDocumentTagDefinitionsBody = z.input<
  typeof v2SaveKnowledgeDocumentTagDefinitionsBodySchema
>

export const v2SaveKnowledgeDocumentTagDefinitionsDataSchema = z
  .object({
    created: z.array(v2KnowledgeTagSchema).describe('Definitions that did not previously exist.'),
    updated: z.array(v2KnowledgeTagSchema).describe('Definitions whose slot was already defined.'),
    errors: z
      .array(z.string())
      .describe('Per-definition failures. A populated array still answers 200.'),
  })
  .strict()
  .meta({
    id: 'V2SaveKnowledgeDocumentTagDefinitionsData',
    title: 'Save knowledge document tag definitions data',
    description: 'Definitions created and updated by a document tag-definition save.',
  })

/**
 * Cleanup only.
 *
 * The domain operation also accepts `action: "all"`, which deletes **every**
 * tag definition on the knowledge base rather than the document's — a
 * whole-vocabulary wipe reachable from a document-scoped path. It is not
 * exposed here, for the same reason bulk delete is absent from
 * `PATCH /api/v2/knowledge/{id}/documents`. Delete definitions one at a time
 * with `DELETE /api/v2/knowledge/{id}/tags/{tagId}`.
 */
export const v2DeleteKnowledgeDocumentTagDefinitionsQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the knowledge base.'),
    action: z
      .literal('cleanup')
      .default('cleanup')
      .describe('Remove tag definitions no document in this knowledge base still uses.'),
  })
  .strict()
export type V2DeleteKnowledgeDocumentTagDefinitionsQuery = z.output<
  typeof v2DeleteKnowledgeDocumentTagDefinitionsQuerySchema
>

export const v2DeleteKnowledgeDocumentTagDefinitionsDataSchema = z
  .object({
    action: z.literal('cleanup').describe('Action that was performed.'),
    count: z.number().int().nonnegative().describe('Number of tag definitions removed.'),
  })
  .strict()
  .meta({
    id: 'V2DeleteKnowledgeDocumentTagDefinitionsData',
    title: 'Delete knowledge document tag definitions data',
    description: 'Outcome of a tag-definition cleanup.',
  })

export const v2CreateKnowledgeTagContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/knowledge/[id]/tags',
  query: noInputSchema,
  params: v2KnowledgeBaseParamsSchema,
  body: v2CreateKnowledgeTagBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2KnowledgeTagSchema),
    status: 201,
  },
})

export const v2UpdateKnowledgeTagContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/knowledge/[id]/tags/[tagId]',
  query: noInputSchema,
  params: v2KnowledgeTagParamsSchema,
  body: v2UpdateKnowledgeTagBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2KnowledgeTagSchema),
  },
})

export const v2DeleteKnowledgeTagContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/knowledge/[id]/tags/[tagId]',
  params: v2KnowledgeTagParamsSchema,
  query: v2KnowledgeWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2DeleteKnowledgeTagDataSchema),
  },
})

export const v2GetNextKnowledgeTagSlotContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/knowledge/[id]/tags/next-slot',
  params: v2KnowledgeBaseParamsSchema,
  query: v2NextKnowledgeTagSlotQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2NextKnowledgeTagSlotDataSchema),
  },
})

/**
 * Tag usage is a full-set list for the same reason the vocabulary is: one row
 * per definition, and the fixed slot table bounds how many definitions exist.
 */
export const v2ListKnowledgeTagUsageContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/knowledge/[id]/tags/usage',
  params: v2KnowledgeBaseParamsSchema,
  query: v2KnowledgeWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2KnowledgeTagUsageSchema, { paged: false }),
  },
})

/**
 * `PUT`, not `PATCH`: the body declares the definitions the document's tags
 * need, and every named slot is written to that declaration. Slots the body
 * does not name are left alone, so this replaces per slot rather than across
 * the vocabulary.
 */
export const v2SaveKnowledgeDocumentTagDefinitionsContract = defineRouteContract({
  method: 'PUT',
  path: '/api/v2/knowledge/[id]/documents/[documentId]/tags',
  query: noInputSchema,
  params: v2KnowledgeDocumentParamsSchema,
  body: v2SaveKnowledgeDocumentTagDefinitionsBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2SaveKnowledgeDocumentTagDefinitionsDataSchema),
  },
})

export const v2DeleteKnowledgeDocumentTagDefinitionsContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/knowledge/[id]/documents/[documentId]/tags',
  params: v2KnowledgeDocumentParamsSchema,
  query: v2DeleteKnowledgeDocumentTagDefinitionsQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2DeleteKnowledgeDocumentTagDefinitionsDataSchema),
  },
})
