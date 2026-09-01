import type { NetSuiteListRecordsParams, NetSuiteResponse } from '@/tools/netsuite/types'
import { netsuiteAuthParamFields } from '@/tools/netsuite/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const netsuiteListRecordsTool: InternalToolConfig<
  NetSuiteListRecordsParams,
  NetSuiteResponse
> = {
  id: 'netsuite_list_records',
  name: 'NetSuite List/Search Records',
  description:
    'List one page of a NetSuite record collection, optionally filtered with a q expression.',
  version: '1.0.0',
  params: {
    ...netsuiteAuthParamFields,
    recordType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'NetSuite REST record type script ID, such as customer or salesOrder',
    },
    q: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'NetSuite record collection filter expression',
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
  operation: {
    input: createInternalToolOperationInput,
  },
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
          description: 'Matching record references in this page',
          optional: true,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'NetSuite record ID' },
              links: {
                type: 'array',
                description: 'Oracle HATEOAS links for the record',
                items: {
                  type: 'object',
                  properties: {
                    rel: { type: 'string', description: 'Link relationship', optional: true },
                    href: { type: 'string', description: 'Link target', optional: true },
                  },
                },
              },
            },
          },
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
