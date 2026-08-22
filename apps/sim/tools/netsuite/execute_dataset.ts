import type { NetSuiteExecuteDatasetParams, NetSuiteResponse } from '@/tools/netsuite/types'
import {
  encodePathSegment,
  executeNetSuiteRequest,
  netsuiteAuthParamFields,
  normalizePagination,
} from '@/tools/netsuite/utils'
import type { ToolConfig } from '@/tools/types'

export const netsuiteExecuteDatasetTool: ToolConfig<
  NetSuiteExecuteDatasetParams,
  NetSuiteResponse
> = {
  id: 'netsuite_execute_dataset',
  name: 'NetSuite Execute SuiteAnalytics Dataset',
  description: 'Execute one page of a standard or custom SuiteAnalytics Workbook dataset.',
  version: '1.0.0',
  params: {
    ...netsuiteAuthParamFields,
    datasetId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'SuiteAnalytics dataset script ID',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 100,
      description: 'Results to return in this page (1-1000; default 100)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 0,
      description:
        'Zero-based result offset; must be divisible by limit and stay within the first 100,000 results and 1,000 pages',
    },
  },
  request: { url: () => '', method: 'POST', headers: () => ({}) },
  directExecution: (params, signal) =>
    executeNetSuiteRequest(
      params,
      () => ({
        method: 'GET',
        path: `/services/rest/query/v1/dataset/${encodePathSegment(params.datasetId, 'Dataset ID')}/result`,
        success: { status: 200, body: 'object', validator: 'collection-page' },
        query: normalizePagination(params.limit, params.offset),
      }),
      signal
    ),
  outputs: {
    status: { type: 'number', description: 'HTTP status returned by NetSuite' },
    data: {
      type: 'json',
      description: 'One documented NetSuite collection page',
      nullable: true,
      properties: {
        links: {
          type: 'array',
          description: 'Oracle HATEOAS links for the response',
          optional: true,
          items: {
            type: 'object',
            properties: {
              rel: { type: 'string', description: 'Link relationship', optional: true },
              href: { type: 'string', description: 'Link target', optional: true },
            },
          },
        },
        items: {
          type: 'array',
          description: 'Items in this page; item fields depend on the record, query, or dataset',
          optional: true,
          items: { type: 'json', description: 'Account-specific NetSuite item' },
        },
        count: { type: 'number', description: 'Number of items in this page', optional: true },
        hasMore: {
          type: 'boolean',
          description: 'Whether another page is available',
          optional: true,
        },
        offset: { type: 'number', description: 'Offset of this page', optional: true },
        totalResults: {
          type: 'number',
          description: 'Total number of matching items',
          optional: true,
        },
      },
    },
  },
}
