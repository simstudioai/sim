import type {
  AffinityCreateMergeParams,
  AffinityMergeAcceptedResponse,
} from '@/tools/affinity/types'
import {
  AFFINITY_MERGE_ENTITY_TYPES,
  AFFINITY_MERGE_PREFIXES,
  affinityError,
  affinityHeaders,
  buildAffinityUrl,
  readAffinityJson,
  requireId,
  requireOneOf,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityCreateMergeTool: ToolConfig<
  AffinityCreateMergeParams,
  AffinityMergeAcceptedResponse
> = {
  id: 'affinity_create_merge',
  name: 'Affinity Create Merge',
  description:
    'Fold a duplicate company or person into the record you are keeping. The merge runs asynchronously — poll the returned task to see it finish. Requires the "Manage duplicates" permission and an admin role.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.ERRORS_ARRAY_STRING,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Affinity API key, sent as a bearer token',
    },
    entityType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'What to merge: companies or persons',
    },
    primaryId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the record to keep',
    },
    duplicateId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the duplicate record to fold in',
    },
  },

  request: {
    url: (params) => {
      const entityType = requireOneOf(params.entityType, AFFINITY_MERGE_ENTITY_TYPES, 'entityType')
      return buildAffinityUrl(`/${AFFINITY_MERGE_PREFIXES[entityType]}-merges`)
    },
    method: 'POST',
    headers: (params) => affinityHeaders(params.apiKey, true),
    body: (params) => {
      const entityType = requireOneOf(params.entityType, AFFINITY_MERGE_ENTITY_TYPES, 'entityType')
      const primary = requireId(params.primaryId, 'primaryId')
      const duplicate = requireId(params.duplicateId, 'duplicateId')

      return entityType === 'companies'
        ? { primaryCompanyId: primary, duplicateCompanyId: duplicate }
        : { primaryPersonId: primary, duplicatePersonId: duplicate }
    },
  },

  transformResponse: async (response) => {
    if (!response.ok) throw await affinityError(response)
    const data = await readAffinityJson<{ taskUrl?: string }>(response)
    return { success: true, output: { taskUrl: data.taskUrl ?? '' } }
  },

  outputs: {
    taskUrl: {
      type: 'string',
      description: 'URL of the merge task to poll for completion',
    },
  },
}
