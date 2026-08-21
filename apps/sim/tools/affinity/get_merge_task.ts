import type { AffinityEntityResponse, AffinityGetMergeTaskParams } from '@/tools/affinity/types'
import { MERGE_TASK_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  AFFINITY_MERGE_ENTITY_TYPES,
  AFFINITY_MERGE_PREFIXES,
  affinityHeaders,
  buildAffinityUrl,
  requireOneOf,
  requireParam,
  transformEntity,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityGetMergeTaskTool: ToolConfig<
  AffinityGetMergeTaskParams,
  AffinityEntityResponse<Record<string, unknown>>
> = {
  id: 'affinity_get_merge_task',
  name: 'Affinity Get Merge Task',
  description:
    'Read one merge task and how its merges are progressing. Poll this after starting a merge.',
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
      description: 'Which merge task to read: companies or persons',
    },
    taskId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The merge task ID',
    },
  },

  request: {
    url: (params) => {
      const entityType = requireOneOf(params.entityType, AFFINITY_MERGE_ENTITY_TYPES, 'entityType')
      const taskId = encodeURIComponent(requireParam(params.taskId, 'taskId'))
      return buildAffinityUrl(`/tasks/${AFFINITY_MERGE_PREFIXES[entityType]}-merges/${taskId}`)
    },
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformEntity(),

  outputs: MERGE_TASK_OUTPUT_PROPERTIES,
}
