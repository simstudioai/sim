import { authParams } from '@/tools/servicenow/params'
import type {
  ServiceNowGetKnowledgeArticleParams,
  ServiceNowGetKnowledgeArticleResponse,
} from '@/tools/servicenow/types'
import {
  buildServiceNowHeaders,
  normalizeInstanceUrl,
  parseServiceNowResponse,
  readRecord,
  readRecordArray,
  readString,
  toRecordObject,
  withQueryString,
} from '@/tools/servicenow/utils'
import type { ToolConfig } from '@/tools/types'

export const getKnowledgeArticleTool: ToolConfig<
  ServiceNowGetKnowledgeArticleParams,
  ServiceNowGetKnowledgeArticleResponse
> = {
  id: 'servicenow_get_knowledge_article',
  name: 'Get ServiceNow Knowledge Article',
  description:
    'Retrieve the full content of a ServiceNow knowledge article by sys_id or KB number through the Knowledge Management API.',
  version: '1.0.0',

  params: {
    ...authParams,
    articleId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'sys_id or KB number of the knowledge article (e.g., KB0000011).',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated kb_knowledge fields to include alongside the article content (e.g., workflow_state,author).',
    },
    language: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Two-letter ISO 639-1 language code. Only applies when the article is addressed by KB number and a translation exists.',
    },
    updateView: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Set to true to increment the article view count and record an entry in the Knowledge Use [kb_use] table.',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = normalizeInstanceUrl(params.instanceUrl)
      const articleId = params.articleId?.trim()
      if (!articleId) {
        throw new Error('A knowledge article sys_id or KB number is required')
      }

      const searchParams = new URLSearchParams()
      if (params.fields) searchParams.append('fields', params.fields)
      if (params.language) searchParams.append('language', params.language)
      if (params.updateView === true || params.updateView === 'true') {
        searchParams.append('update_view', 'true')
      }

      return withQueryString(
        `${baseUrl}/api/sn_km_api/knowledge/articles/${encodeURIComponent(articleId)}`,
        searchParams
      )
    },
    method: 'GET',
    headers: (params) => buildServiceNowHeaders(params),
  },

  transformResponse: async (response: Response) => {
    const data = await parseServiceNowResponse(response)
    const result = toRecordObject(data.result)

    return {
      success: true,
      output: {
        sysId: readString(result, 'sys_id'),
        number: readString(result, 'number'),
        title: readString(result, 'short_description'),
        content: readString(result, 'content'),
        fields: readRecord(result, 'fields'),
        attachments: readRecordArray(result, 'attachments'),
      },
    }
  },

  outputs: {
    sysId: { type: 'string', description: 'Article sys_id on kb_knowledge', nullable: true },
    number: { type: 'string', description: 'Knowledge article number', nullable: true },
    title: {
      type: 'string',
      description: 'Article title (short description)',
      nullable: true,
    },
    content: { type: 'string', description: 'Full HTML content of the article', nullable: true },
    fields: {
      type: 'json',
      description: 'Requested kb_knowledge fields, each {name, label, type, value, display_value}',
      nullable: true,
    },
    attachments: {
      type: 'array',
      description:
        'Article attachments, returned only when display_attachments is active on the article',
      items: {
        type: 'object',
        properties: {
          sys_id: { type: 'string', description: 'Attachment sys_id' },
          file_name: { type: 'string', description: 'Attachment file name' },
          size_bytes: { type: 'string', description: 'Attachment size in bytes' },
          state: {
            type: 'string',
            description:
              'Attachment state: available, available_conditionally, not_available, or pending',
          },
        },
      },
    },
  },
}
