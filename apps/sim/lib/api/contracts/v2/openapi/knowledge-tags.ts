import {
  v2BulkSaveKnowledgeTagDefinitionsContract,
  v2CreateKnowledgeTagContract,
  v2DeleteKnowledgeTagContract,
  v2DeleteKnowledgeTagDefinitionsContract,
  v2GetNextKnowledgeTagSlotContract,
  v2ListKnowledgeTagUsageContract,
  v2UpdateKnowledgeTagContract,
} from '@/lib/api/contracts/v2/knowledge-tags'
import {
  KNOWLEDGE_WORKSPACE_ID,
  knowledgeOperation,
} from '@/lib/api/contracts/v2/openapi/knowledge-shared'
import {
  documentedSchema,
  FULL_SET_LIST,
  RESOURCE_CONFLICT_ERRORS,
  RESOURCE_ERRORS,
  WORKSPACE_API_KEY_DENIED,
} from '@/lib/api/contracts/v2/openapi/shared'
import { defineOpenApiRoute } from '@/lib/api/openapi/types'

/**
 * Tag-definition write operations of the knowledge OpenAPI document.
 *
 * The read half (`listKnowledgeTags`) lives beside the knowledge-base
 * operations because it is the mapping every document read and tag filter
 * depends on; these are the writes that let a caller create that mapping in the
 * first place.
 */

const TAG_LOOP =
  'Define a tag here, write its `tagSlot` on a document with `PATCH /api/v2/knowledge/{knowledgeBaseId}/documents/{documentId}`, then filter by its `displayName` on the document list or on search.'

export const knowledgeTagOpenApiRoutes = [
  defineOpenApiRoute(
    v2CreateKnowledgeTagContract,
    knowledgeOperation({
      operationId: 'createKnowledgeTag',
      summary: 'Create Tag',
      description: `Define one tag on a knowledge base; use \`PUT\` on this path to declare several at once. ${TAG_LOOP} Omit \`tagSlot\` to take the next free slot for the field type; a field type with no free slot left is a \`400\` naming it, since the remedy is a different type or a deleted definition rather than a retry. A \`tagSlot\` already taken, or a \`displayName\` already defined on this knowledge base, is a \`409\` naming which of the two to change. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'The created tag definition.' },
    }),
    {
      query: v2CreateKnowledgeTagContract.query,
      params: documentedSchema(
        v2CreateKnowledgeTagContract.params,
        'CreateKnowledgeTagParams',
        'Create knowledge tag path parameters',
        'Knowledge base the tag is defined on.'
      ),
      body: documentedSchema(
        v2CreateKnowledgeTagContract.body,
        'CreateKnowledgeTagRequest',
        'Create knowledge tag request',
        'Workspace scope, display name, field type, and optional slot.',
        [{ workspaceId: KNOWLEDGE_WORKSPACE_ID, displayName: 'category', fieldType: 'text' }]
      ),
      response: documentedSchema(
        v2CreateKnowledgeTagContract.response.schema,
        'V2KnowledgeTagResponse',
        'Knowledge tag response',
        'A single tag definition.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdateKnowledgeTagContract,
    knowledgeOperation({
      operationId: 'updateKnowledgeTag',
      summary: 'Update Tag',
      description: `Rename a tag, or change the value type stored in its slot. Renaming changes the name filters and document reads use; the slot, and every value in it, is untouched. A tag's slot is fixed for its lifetime and each slot holds one kind of value, so \`fieldType\` can only change to another type valid for the slot the tag already occupies — anything else is a \`400\`, and the way to get a tag of that type is to create one. A name another tag on this knowledge base already holds is a \`409\`. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'The updated tag definition.' },
    }),
    {
      query: v2UpdateKnowledgeTagContract.query,
      params: documentedSchema(
        v2UpdateKnowledgeTagContract.params,
        'UpdateKnowledgeTagParams',
        'Update knowledge tag path parameters',
        'Knowledge base and tag definition selected for update.'
      ),
      body: documentedSchema(
        v2UpdateKnowledgeTagContract.body,
        'UpdateKnowledgeTagRequest',
        'Update knowledge tag request',
        'Workspace scope and the fields to update. At least one is required.',
        [{ workspaceId: KNOWLEDGE_WORKSPACE_ID, displayName: 'topic' }]
      ),
      response: documentedSchema(
        v2UpdateKnowledgeTagContract.response.schema,
        'V2KnowledgeTagResponse',
        'Knowledge tag response',
        'A single tag definition.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2DeleteKnowledgeTagContract,
    knowledgeOperation({
      operationId: 'deleteKnowledgeTag',
      summary: 'Delete Tag',
      description: `Remove a tag definition and clear its slot across every document and chunk in the knowledge base. Without a definition the slot has no meaning, so leaving the values would strand them under a raw slot name — this is not recoverable. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'Tag deletion acknowledgement.' },
    }),
    {
      params: documentedSchema(
        v2DeleteKnowledgeTagContract.params,
        'DeleteKnowledgeTagParams',
        'Delete knowledge tag path parameters',
        'Knowledge base and tag definition selected for deletion.'
      ),
      query: documentedSchema(
        v2DeleteKnowledgeTagContract.query,
        'DeleteKnowledgeTagQuery',
        'Delete knowledge tag query',
        'Workspace scope for the knowledge base.'
      ),
      response: documentedSchema(
        v2DeleteKnowledgeTagContract.response.schema,
        'V2DeleteKnowledgeTagResponse',
        'Delete knowledge tag response',
        'Acknowledgement naming the deleted definition and the slot it freed.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetNextKnowledgeTagSlotContract,
    knowledgeOperation({
      operationId: 'getNextKnowledgeTagSlot',
      summary: 'Get Next Tag Slot',
      description: `Report which slot a create would take for a field type, and how many are left. Advisory rather than a claim: nothing is reserved, and \`POST /api/v2/knowledge/{knowledgeBaseId}/tags\` assigns the same slot when \`tagSlot\` is omitted. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_ERRORS,
      success: { description: 'Slot availability for the requested field type.' },
    }),
    {
      params: documentedSchema(
        v2GetNextKnowledgeTagSlotContract.params,
        'GetNextKnowledgeTagSlotParams',
        'Next knowledge tag slot path parameters',
        'Knowledge base whose slot availability is reported.'
      ),
      query: documentedSchema(
        v2GetNextKnowledgeTagSlotContract.query,
        'GetNextKnowledgeTagSlotQuery',
        'Next knowledge tag slot query',
        'Workspace scope and the field type to count slots for.'
      ),
      response: documentedSchema(
        v2GetNextKnowledgeTagSlotContract.response.schema,
        'V2NextKnowledgeTagSlotResponse',
        'Next knowledge tag slot response',
        'Slot availability for one tag field type.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListKnowledgeTagUsageContract,
    knowledgeOperation({
      operationId: 'listKnowledgeTagUsage',
      summary: 'List Tag Usage',
      description: `Report how many documents and chunks carry a value for each defined tag, so a caller can tell a tag that is actually populated from one that was only declared. ${FULL_SET_LIST} ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_ERRORS,
      success: { description: 'Usage counts for every defined tag.' },
    }),
    {
      params: documentedSchema(
        v2ListKnowledgeTagUsageContract.params,
        'ListKnowledgeTagUsageParams',
        'Knowledge tag usage path parameters',
        'Knowledge base whose tag usage is reported.'
      ),
      query: documentedSchema(
        v2ListKnowledgeTagUsageContract.query,
        'ListKnowledgeTagUsageQuery',
        'Knowledge tag usage query',
        'Workspace scope for the knowledge base.'
      ),
      response: documentedSchema(
        v2ListKnowledgeTagUsageContract.response.schema,
        'V2KnowledgeTagUsageListResponse',
        'Knowledge tag usage response',
        'Usage counts for every tag defined on one knowledge base.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2BulkSaveKnowledgeTagDefinitionsContract,
    knowledgeOperation({
      operationId: 'bulkSaveKnowledgeTagDefinitions',
      summary: 'Bulk Save Tag Definitions',
      description: `Declare, in one request, several of the knowledge base's tag definitions. \`POST\` on this path defines exactly one tag; this is the same write over a list, and every slot the body names is written to the declaration it carries while slots it does not name are left alone. Updating an existing definition requires naming its current name in \`originalDisplayName\`; that is the only form that edits one in place. Without it the entry is a create, and a requested \`tagSlot\` another name already holds is refused in \`errors\` — it is neither overwritten nor relocated to a different slot, so an explicitly requested slot always means that slot or an error. A create whose \`displayName\` already exists is refused in \`errors\`. Per-definition failures are reported in \`errors\` and still answer \`200\`. This writes the vocabulary, not one document's tag values — set those with \`PATCH /api/v2/knowledge/{knowledgeBaseId}/documents/{documentId}\`. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_ERRORS,
      success: { description: 'Definitions created and updated by the save.' },
    }),
    {
      query: v2BulkSaveKnowledgeTagDefinitionsContract.query,
      params: documentedSchema(
        v2BulkSaveKnowledgeTagDefinitionsContract.params,
        'BulkSaveKnowledgeTagDefinitionsParams',
        'Bulk save tag definitions path parameters',
        'Knowledge base whose tag vocabulary is written.'
      ),
      body: documentedSchema(
        v2BulkSaveKnowledgeTagDefinitionsContract.body,
        'BulkSaveKnowledgeTagDefinitionsRequest',
        'Bulk save tag definitions request',
        'Workspace scope and the tag definitions to create or update.',
        [
          {
            workspaceId: KNOWLEDGE_WORKSPACE_ID,
            definitions: [{ tagSlot: 'tag1', displayName: 'category', fieldType: 'text' }],
          },
        ]
      ),
      response: documentedSchema(
        v2BulkSaveKnowledgeTagDefinitionsContract.response.schema,
        'V2BulkSaveKnowledgeTagDefinitionsResponse',
        'Bulk save tag definitions response',
        'Definitions created and updated, with any per-definition failures.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2DeleteKnowledgeTagDefinitionsContract,
    knowledgeOperation({
      operationId: 'deleteKnowledgeTagDefinitions',
      summary: 'Delete Tag Definitions',
      description: `Remove tag definitions from the knowledge base. \`unused\` defaults to \`true\`, which removes only the definitions no document still carries a value for — the recoverable half, since a definition with nothing behind it can simply be redefined. Pass \`unused=false\` to delete every definition on the knowledge base, which also clears its slot on every document and chunk and is not recoverable. Delete one definition at a time with \`DELETE /api/v2/knowledge/{knowledgeBaseId}/tags/{tagId}\`. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_ERRORS,
      success: { description: 'Number of tag definitions removed.' },
    }),
    {
      params: documentedSchema(
        v2DeleteKnowledgeTagDefinitionsContract.params,
        'DeleteKnowledgeTagDefinitionsParams',
        'Delete tag definitions path parameters',
        'Knowledge base whose tag definitions are removed.'
      ),
      query: documentedSchema(
        v2DeleteKnowledgeTagDefinitionsContract.query,
        'DeleteKnowledgeTagDefinitionsQuery',
        'Delete tag definitions query',
        'Workspace scope and how much of the vocabulary to remove.'
      ),
      response: documentedSchema(
        v2DeleteKnowledgeTagDefinitionsContract.response.schema,
        'V2DeleteKnowledgeTagDefinitionsResponse',
        'Delete tag definitions response',
        'Number of tag definitions that were removed.'
      ),
    }
  ),
] as const
