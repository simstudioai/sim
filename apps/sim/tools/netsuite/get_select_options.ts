import type { NetSuiteGetSelectOptionsParams, NetSuiteResponse } from '@/tools/netsuite/types'
import { netsuiteAuthParamFields } from '@/tools/netsuite/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const netsuiteGetSelectOptionsTool: InternalToolConfig<
  NetSuiteGetSelectOptionsParams,
  NetSuiteResponse
> = {
  id: 'netsuite_get_select_options',
  name: 'NetSuite Get Select Options',
  description: 'Retrieve valid select values for one or more fields on a new or existing record.',
  version: '1.0.0',
  params: {
    ...netsuiteAuthParamFields,
    recordType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'NetSuite REST record type script ID, such as customer or salesOrder',
    },
    recordId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Existing record ID; omit to evaluate options for a new record',
    },
    fields: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated select field IDs',
    },
    q: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional select-option filter using CONTAIN, IS, or START_WITH',
    },
    body: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Record fields matching the account-specific NetSuite metadata schema',
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
      description:
        'Select-options response keyed by requested field ID; each dynamic field contains an _selectOptions object with links, items, count, offset, hasMore, and totalResults',
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
      },
    },
  },
}
