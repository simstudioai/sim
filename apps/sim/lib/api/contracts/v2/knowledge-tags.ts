import { z } from 'zod'
import { knowledgeTagParamsSchema } from '@/lib/api/contracts/knowledge/shared'
import {
  booleanQueryFlagSchema,
  noInputSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2KnowledgeBaseParamsSchema, v2KnowledgeTagSchema } from '@/lib/api/contracts/v2/knowledge'
import { v2CursorListResponse, v2DataResponse } from '@/lib/api/contracts/v2/shared'
import {
  ALL_TAG_SLOTS,
  KNOWLEDGE_TAG_DISPLAY_NAME_MAX_LENGTH,
  SUPPORTED_FIELD_TYPES,
  TAG_SLOT_CONFIG,
} from '@/lib/knowledge/constants'

/**
 * v2 knowledge tag-definition writes.
 *
 * All of them are knowledge-base scoped, because a tag definition is: the rows
 * live in `knowledge_base_tag_definitions`, keyed by knowledge base and slot,
 * and every document in the base reads the same vocabulary.
 *
 * The read half (`GET /api/v2/knowledge/{knowledgeBaseId}/tags`) shipped first, which left
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

export const v2KnowledgeTagParamsSchema = knowledgeTagParamsSchema.omit({ id: true }).extend({
  knowledgeBaseId: knowledgeTagParamsSchema.shape.id.describe('Unique knowledge base identifier.'),
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
        `Total slots this field type has: ${SUPPORTED_FIELD_TYPES.map(
          (fieldType) => `${TAG_SLOT_CONFIG[fieldType].maxSlots} for ${fieldType}`
        ).join(', ')}.`
      ),
    availableSlots: z
      .number()
      .int()
      .nonnegative()
      .describe('Slots of this field type still free, or 0 when the field type is exhausted.'),
  })
  .strict()
  .meta({
    id: 'V2NextKnowledgeTagSlotData',
    title: 'Next knowledge tag slot',
    description: 'Slot availability for one tag field type.',
  })

export const v2KnowledgeTagUsageSchema = z
  .object({
    id: z
      .string()
      .describe('Tag definition ID used by Update Tag and Delete Tag.')
      .meta({ examples: ['7c9e6679-7425-40de-944b-e07fc1f90ae7'] }),
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
 * One tag definition in a bulk save.
 *
 * `originalDisplayName` names the definition being renamed. It is how a bulk
 * save distinguishes "rename the tag in this slot" from "define a new one". A
 * slot already holding a definition under a different name is refused in
 * `errors` rather than having its occupant silently renamed: every document
 * already tagged through that slot keeps its values, so a rename that was not
 * asked for would relabel existing data and break saved filters keyed on the
 * old name. Rename it by naming its current name in `originalDisplayName`.
 */
export const v2BulkSaveKnowledgeTagDefinitionSchema = z
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
    id: 'V2BulkSaveKnowledgeTagDefinition',
    title: 'Knowledge tag definition input',
    description: 'One tag definition declared in a bulk save.',
  })

export const v2BulkSaveKnowledgeTagDefinitionsBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the knowledge base.'),
    definitions: z
      .array(v2BulkSaveKnowledgeTagDefinitionSchema)
      .min(1, 'definitions must contain at least one tag definition')
      .max(
        ALL_TAG_SLOTS.length,
        `definitions cannot contain more than ${ALL_TAG_SLOTS.length} entries — one per slot`
      )
      .describe('Tag definitions to create or update on the knowledge base.'),
  })
  .strict()
export type V2BulkSaveKnowledgeTagDefinitionsBody = z.input<
  typeof v2BulkSaveKnowledgeTagDefinitionsBodySchema
>

export const v2BulkSaveKnowledgeTagDefinitionsDataSchema = z
  .object({
    created: z.array(v2KnowledgeTagSchema).describe('Definitions that did not previously exist.'),
    updated: z.array(v2KnowledgeTagSchema).describe('Definitions whose slot was already defined.'),
    errors: z
      .array(z.string())
      .describe('Per-definition failures. A populated array still answers 200.'),
  })
  .strict()
  .meta({
    id: 'V2BulkSaveKnowledgeTagDefinitionsData',
    title: 'Bulk save knowledge tag definitions data',
    description: 'Definitions created and updated by a bulk tag-definition save.',
  })

/**
 * `unused` selects how much of the vocabulary the delete removes.
 *
 * It defaults to `true` — remove only the definitions no document still carries
 * a value for — because that is the recoverable half: a definition with no
 * values behind it can be recreated at no cost. `unused=false` deletes **every**
 * definition on the knowledge base and clears its slot on every document and
 * chunk, so it is stated explicitly or not at all.
 *
 * A real boolean rather than the `action` string literal this replaced. That
 * literal was a guard, not a parameter: the delete used to hang off a
 * document-scoped path where a whole-vocabulary wipe was reachable from a URL
 * that named one document. The path now names the knowledge base the delete
 * actually acts on, so both halves are legitimate and the guard is gone.
 */
export const v2DeleteKnowledgeTagDefinitionsQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the knowledge base.'),
    unused: booleanQueryFlagSchema
      .default(true)
      .describe(
        'Whether to remove only the tag definitions no document in the knowledge base still carries a value for. Defaults to true. Pass `unused=false` to delete every definition on the knowledge base, which also clears its slot on every document and chunk and is not recoverable.'
      ),
  })
  .strict()
export type V2DeleteKnowledgeTagDefinitionsQuery = z.output<
  typeof v2DeleteKnowledgeTagDefinitionsQuerySchema
>

export const v2DeleteKnowledgeTagDefinitionsDataSchema = z
  .object({
    unused: z
      .boolean()
      .describe('Whether the delete was restricted to definitions no document still uses.'),
    count: z.number().int().nonnegative().describe('Number of tag definitions removed.'),
  })
  .strict()
  .meta({
    id: 'V2DeleteKnowledgeTagDefinitionsData',
    title: 'Delete knowledge tag definitions data',
    description: 'Outcome of a knowledge-base tag-definition delete.',
  })

export const v2CreateKnowledgeTagContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/knowledge/[knowledgeBaseId]/tags',
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
  path: '/api/v2/knowledge/[knowledgeBaseId]/tags/[tagId]',
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
  path: '/api/v2/knowledge/[knowledgeBaseId]/tags/[tagId]',
  params: v2KnowledgeTagParamsSchema,
  query: v2KnowledgeWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2DeleteKnowledgeTagDataSchema),
  },
})

export const v2GetNextKnowledgeTagSlotContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/knowledge/[knowledgeBaseId]/tags/next-slot',
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
  path: '/api/v2/knowledge/[knowledgeBaseId]/tags/usage',
  params: v2KnowledgeBaseParamsSchema,
  query: v2KnowledgeWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2KnowledgeTagUsageSchema, { paged: false }),
  },
})

/**
 * Bulk upsert of the knowledge base's tag vocabulary.
 *
 * On the knowledge base rather than a document: the write targets
 * `knowledge_base_tag_definitions`, keyed by knowledge base and slot, and every
 * document in the base sees the result. It used to hang off
 * `PUT /knowledge/{knowledgeBaseId}/documents/{documentId}/tags`, where the document id was
 * read only to find the knowledge base behind it and the path promised a
 * document-scoped write it never performed. Tag *values* on one document are
 * written by `PATCH /api/v2/knowledge/{knowledgeBaseId}/documents/{documentId}` through its
 * tag slots.
 *
 * `PUT`, not `PATCH`: every named slot is written to the body's declaration.
 * Slots the body does not name are left alone, so this replaces per slot rather
 * than across the vocabulary — which is also why it is a second verb on this
 * path rather than a repeated `POST`, which defines exactly one.
 */
export const v2BulkSaveKnowledgeTagDefinitionsContract = defineRouteContract({
  method: 'PUT',
  path: '/api/v2/knowledge/[knowledgeBaseId]/tags',
  query: noInputSchema,
  params: v2KnowledgeBaseParamsSchema,
  body: v2BulkSaveKnowledgeTagDefinitionsBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2BulkSaveKnowledgeTagDefinitionsDataSchema),
  },
})

/** Collection delete over the same vocabulary the bulk save writes. */
export const v2DeleteKnowledgeTagDefinitionsContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/knowledge/[knowledgeBaseId]/tags',
  params: v2KnowledgeBaseParamsSchema,
  query: v2DeleteKnowledgeTagDefinitionsQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2DeleteKnowledgeTagDefinitionsDataSchema),
  },
})
