import type { NetSuiteListRecordTypesParams, NetSuiteResponse } from '@/tools/netsuite/types'
import { netsuiteAuthParamFields } from '@/tools/netsuite/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const netsuiteListRecordTypesTool: InternalToolConfig<
  NetSuiteListRecordTypesParams,
  NetSuiteResponse
> = {
  id: 'netsuite_list_record_types',
  name: 'NetSuite List Record Types',
  description: 'List record types exposed to the authenticated role by the REST metadata catalog.',
  version: '1.0.0',
  params: {
    ...netsuiteAuthParamFields,
  },
  operation: {
    input: createInternalToolOperationInput,
  },
  outputs: {
    status: { type: 'number', description: 'HTTP status returned by NetSuite' },
    data: {
      type: 'json',
      description: 'NetSuite REST metadata catalog',
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
          description: 'Record types exposed to the authenticated role',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'REST record type script ID' },
              links: {
                type: 'array',
                description: 'Oracle HATEOAS links for the response',
                optional: true,
                items: {
                  type: 'object',
                  properties: {
                    rel: { type: 'string', description: 'Link relationship', optional: true },
                    href: { type: 'string', description: 'Link target', optional: true },
                    mediaType: {
                      type: 'string',
                      description: 'Media type advertised for the linked metadata resource',
                      optional: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
}
