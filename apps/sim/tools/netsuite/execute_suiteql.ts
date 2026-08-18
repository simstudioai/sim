import type { NetSuiteResponse, NetSuiteSuiteQLParams } from '@/tools/netsuite/types'
import {
  executeNetSuiteRequest,
  netsuiteAuthParamFields,
  normalizePagination,
  requiredTrim,
} from '@/tools/netsuite/utils'
import type { ToolConfig } from '@/tools/types'

export const netsuiteExecuteSuiteQLTool: ToolConfig<NetSuiteSuiteQLParams, NetSuiteResponse> = {
  id: 'netsuite_execute_suiteql',
  name: 'NetSuite Execute SuiteQL',
  description: 'Execute one page of a SuiteQL query through SuiteTalk REST web services.',
  version: '1.0.0',
  params: {
    ...netsuiteAuthParamFields,
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'SuiteQL SELECT query; use a complete unique ORDER BY when retrieving multiple pages',
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
        method: 'POST',
        path: '/services/rest/query/v1/suiteql',
        success: { status: 200, body: 'object', validator: 'suiteql-page' },
        query: normalizePagination(params.limit, params.offset),
        headers: { Prefer: 'transient' },
        body: { q: requiredTrim(params.query, 'SuiteQL query') },
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
