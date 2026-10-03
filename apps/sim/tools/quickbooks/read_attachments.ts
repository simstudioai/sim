import { ErrorExtractorId } from '@/tools/error-extractors'
import { buildQuickBooksCompanyUrl } from '@/tools/quickbooks/client'
import {
  escapeQuickBooksQueryLiteral,
  getQuickBooksAttachmentTarget,
  parseQuickBooksAttachableResponse,
  sanitizeQuickBooksAttachable,
} from '@/tools/quickbooks/documents_utils'
import type {
  QuickBooksAttachable,
  QuickBooksReadAttachmentsParams,
  QuickBooksReadAttachmentsResponse,
} from '@/tools/quickbooks/types'
import { QUICKBOOKS_ATTACHABLE_PROPERTIES, QUICKBOOKS_LIST_OUTPUTS } from '@/tools/quickbooks/types'
import {
  buildQuickBooksEntityUrl,
  getQuickBooksToolHeaders,
  parseQuickBooksJson,
} from '@/tools/quickbooks/utils'
import { requiredQuickBooksString, validateQuickBooksPagination } from '@/tools/quickbooks/values'
import type { ToolConfig } from '@/tools/types'

interface AttachableQueryEnvelope {
  QueryResponse?: {
    Attachable?: QuickBooksAttachable[]
    startPosition?: number
    maxResults?: number
  }
  time?: string
}

export const quickbooksReadAttachmentsTool: ToolConfig<
  QuickBooksReadAttachmentsParams,
  QuickBooksReadAttachmentsResponse
> = {
  id: 'quickbooks_read_attachments',
  name: 'QuickBooks Read Attachments',
  description:
    'List attachment metadata for a fixed QuickBooks entity or read one attachment by ID',
  version: '1.0.0',
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'QuickBooks OAuth access token',
    },
    realmId: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'QuickBooks company ID derived from the connected credential',
    },
    quickBooksEnvironment: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'QuickBooks API environment derived from the connected credential',
    },
    readMode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Read mode: list or by_id',
    },
    targetType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Fixed QuickBooks entity type for List mode',
    },
    targetId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'QuickBooks entity ID for List mode',
    },
    attachmentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'QuickBooks attachment ID for By ID mode',
    },
    startPosition: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'One-based list start position; defaults to 1',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'List page size from 1 through 100; defaults to 25',
    },
  },
  oauth: {
    required: true,
    provider: 'quickbooks',
    authoritativeParams: ['realmId', 'quickBooksEnvironment'],
    requiredScopes: ['com.intuit.quickbooks.accounting'],
  },
  errorExtractor: ErrorExtractorId.QUICKBOOKS_FAULT,
  request: {
    url: (params) => {
      if (params.readMode === 'by_id') {
        return buildQuickBooksEntityUrl(
          params,
          'attachable',
          requiredQuickBooksString(params.attachmentId ?? '', 'attachmentId')
        ).toString()
      }
      if (params.readMode !== 'list')
        throw new Error(`Unsupported QuickBooks attachment read mode: ${String(params.readMode)}`)
      const target = getQuickBooksAttachmentTarget(params.targetType!)
      const targetId = escapeQuickBooksQueryLiteral(params.targetId ?? '', 'targetId')
      const pagination = validateQuickBooksPagination(
        params.startPosition ?? 1,
        params.maxResults ?? 25
      )
      const url = buildQuickBooksCompanyUrl(params.realmId, 'query', params.quickBooksEnvironment)
      url.searchParams.set(
        'query',
        `SELECT * FROM Attachable WHERE AttachableRef.EntityRef.Type = '${target.queryEntityType}' AND AttachableRef.EntityRef.value = '${targetId}' STARTPOSITION ${pagination.startPosition} MAXRESULTS ${pagination.maxResults}`
      )
      return url.toString()
    },
    method: 'GET',
    headers: (params) => getQuickBooksToolHeaders(params.accessToken),
    retry: { enabled: false },
  },
  transformResponse: async (response, params) => {
    if (!params) throw new Error('QuickBooks Read Attachments parameters are required')
    if (params.readMode === 'by_id') {
      const parsed = await parseQuickBooksAttachableResponse(response, undefined, 'attachment read')
      return { success: true, output: { item: parsed.attachment, time: parsed.time } }
    }
    const pagination = validateQuickBooksPagination(
      params.startPosition ?? 1,
      params.maxResults ?? 25
    )
    const data = await parseQuickBooksJson<AttachableQueryEnvelope>(
      response,
      'QuickBooks Attachable query response'
    )
    if (
      !data.QueryResponse ||
      typeof data.QueryResponse !== 'object' ||
      Array.isArray(data.QueryResponse)
    ) {
      throw new Error('QuickBooks Attachable response is missing QueryResponse')
    }
    const attachments = data.QueryResponse.Attachable ?? []
    if (!Array.isArray(attachments))
      throw new Error('QuickBooks Attachable response contains a malformed attachment list')
    const items = attachments.map(sanitizeQuickBooksAttachable)
    const startPosition = Number.isInteger(data.QueryResponse.startPosition)
      ? data.QueryResponse.startPosition!
      : pagination.startPosition
    const maxResults = Number.isInteger(data.QueryResponse.maxResults)
      ? data.QueryResponse.maxResults!
      : items.length
    return {
      success: true,
      output: {
        items,
        startPosition,
        maxResults,
        nextStartPosition: startPosition + items.length,
        hasMore: items.length === pagination.maxResults,
        time: typeof data.time === 'string' ? data.time : null,
      },
    }
  },
  outputs: {
    item: {
      type: 'json',
      description: 'Native QuickBooks attachment metadata',
      optional: true,
      properties: QUICKBOOKS_ATTACHABLE_PROPERTIES,
    },
    items: {
      type: 'array',
      description: 'Native QuickBooks attachment metadata page',
      optional: true,
      items: { type: 'json', properties: QUICKBOOKS_ATTACHABLE_PROPERTIES },
    },
    ...QUICKBOOKS_LIST_OUTPUTS,
  },
}
