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
import { knowledgeOperations } from '@/lib/knowledge/application/operations'

/**
 * Tag-definition write operations of the knowledge OpenAPI document.
 *
 * The read half (`listKnowledgeTags`) lives beside the knowledge-base
 * operations because it is the mapping every document read and tag filter
 * depends on; these are the writes that let a caller create that mapping in the
 * first place.
 */

export const knowledgeTagOpenApiRoutes = [
  defineOpenApiRoute(
    v2CreateKnowledgeTagContract,
    knowledgeOperation({
      applicationOperation: knowledgeOperations.createTag,
      operationId: 'createKnowledgeTag',
      summary: 'Create Tag',
      description: `Define one tag; use \`PUT\` on this path for several. Write its \`tagSlot\` on documents, then filter by \`displayName\`. Omitting \`tagSlot\` selects the next free slot; exhaustion returns \`400\`. An occupied slot or duplicate display name returns \`409\` naming the conflict. ${WORKSPACE_API_KEY_DENIED}`,
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
      applicationOperation: knowledgeOperations.updateTag,
      operationId: 'updateKnowledgeTag',
      summary: 'Update Tag',
      description: `Rename a tag or change its slot-compatible \`fieldType\`. Renaming changes read and filter names without moving the slot or its values. Slots are fixed for a tag's lifetime; an incompatible type returns \`400\` and requires creating a new tag. A duplicate display name returns \`409\`. ${WORKSPACE_API_KEY_DENIED}`,
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
      applicationOperation: knowledgeOperations.deleteTag,
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
      applicationOperation: knowledgeOperations.readNextTagSlot,
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
      applicationOperation: knowledgeOperations.readTagUsage,
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
      applicationOperation: knowledgeOperations.saveDocumentTagDefinitions,
      operationId: 'bulkSaveKnowledgeTagDefinitions',
      summary: 'Bulk Save Tag Definitions',
      description: `Declare multiple tag definitions while leaving unspecified slots unchanged. Updating requires the current name in \`originalDisplayName\`; otherwise the entry creates a tag. Occupied explicit slots and duplicate display names appear in per-definition \`errors\`, never overwrite or relocate data, and still return \`200\`. This writes the vocabulary, not document tag values; set those through the document update endpoint. ${WORKSPACE_API_KEY_DENIED}`,
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
      applicationOperation: knowledgeOperations.deleteDocumentTagDefinitions,
      operationId: 'deleteKnowledgeTagDefinitions',
      summary: 'Delete Tag Definitions',
      description: `Remove tag definitions. \`unused\` defaults to \`true\`, deleting only definitions with no document values, which can be recreated safely. \`unused=false\` deletes every definition and irreversibly clears its slot from all documents and chunks. Use \`DELETE /api/v2/knowledge/{knowledgeBaseId}/tags/{tagId}\` to delete one definition. ${WORKSPACE_API_KEY_DENIED}`,
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
