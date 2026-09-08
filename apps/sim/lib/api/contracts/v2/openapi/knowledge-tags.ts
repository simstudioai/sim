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
      description: `Create a tag definition. Write document values by \`tagSlot\` and filter by \`displayName\`. Omitting \`tagSlot\` selects a free slot; exhaustion returns \`400\`. An occupied slot or duplicate name returns \`409\`. Use Bulk Save Tag Definitions for multiple definitions. ${WORKSPACE_API_KEY_DENIED}`,
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
      description: `Permanently delete a tag definition and its values from every document and chunk in the knowledge base. ${WORKSPACE_API_KEY_DENIED}`,
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
      description: `Get the next available slot and remaining capacity for a field type. This does not reserve a slot. Create Tag selects a free slot when \`tagSlot\` is omitted. ${WORKSPACE_API_KEY_DENIED}`,
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
      description: `Count the documents and chunks with a value for each defined tag. ${FULL_SET_LIST} ${WORKSPACE_API_KEY_DENIED}`,
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
      description: `Create or update tag definitions, preserving unspecified slots. Updates require \`originalDisplayName\`; other entries create tags. Slot and name conflicts appear in per-definition \`errors\` with HTTP \`200\`, leaving conflicting values unchanged. Use Update Document to set tag values. ${WORKSPACE_API_KEY_DENIED}`,
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
      description: `Delete unused tag definitions by default. With \`unused=false\`, permanently delete all definitions and their values from documents and chunks. Use Delete Tag to remove one definition. ${WORKSPACE_API_KEY_DENIED}`,
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
