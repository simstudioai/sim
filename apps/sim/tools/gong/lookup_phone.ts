import type { GongLookupPhoneParams, GongLookupPhoneResponse } from '@/tools/gong/types'
import type { ToolConfig } from '@/tools/types'

export const lookupPhoneTool: ToolConfig<GongLookupPhoneParams, GongLookupPhoneResponse> = {
  id: 'gong_lookup_phone',
  name: 'Gong Lookup Phone',
  description:
    'Find all references to a phone number in Gong (calls, email messages, meetings, CRM data, and associated contacts).',
  version: '1.0.0',

  params: {
    accessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Gong API Access Key',
    },
    accessKeySecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Gong API Access Key Secret',
    },
    phoneNumber: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Phone number to look up (must start with + followed by country code)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.gong.io/v2/data-privacy/data-for-phone-number')
      url.searchParams.set('phoneNumber', params.phoneNumber)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.accessKey}:${params.accessKeySecret}`)}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.errors?.[0]?.message || data.message || 'Failed to lookup phone number')
    }
    return {
      success: true,
      output: {
        requestId: data.requestId ?? '',
        suppliedPhoneNumber: data.suppliedPhoneNumber ?? '',
        matchingPhoneNumbers: data.matchingPhoneNumbers ?? [],
        emailAddresses: data.emailAddresses ?? [],
        calls: data.calls ?? [],
        emails: data.emails ?? [],
        meetings: data.meetings ?? [],
        customerData: data.customerData ?? [],
      },
    }
  },

  outputs: {
    requestId: {
      type: 'string',
      description: 'Gong request reference ID for troubleshooting',
    },
    suppliedPhoneNumber: {
      type: 'string',
      description: 'The phone number that was supplied in the request',
    },
    matchingPhoneNumbers: {
      type: 'array',
      description: 'Phone numbers found in the system that match the supplied number',
      items: {
        type: 'string',
      },
    },
    emailAddresses: {
      type: 'array',
      description: 'Email addresses associated with the phone number',
      items: {
        type: 'string',
      },
    },
    calls: {
      type: 'array',
      description: 'Related calls referencing this phone number',
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: "Gong's unique numeric identifier for the call (up to 20 digits)",
          },
          status: { type: 'string', description: 'Call status' },
          externalSystems: {
            type: 'array',
            description: 'Links to external systems such as CRM, Telephony System, etc.',
            items: {
              type: 'object',
              properties: {
                system: { type: 'string', description: 'External system name' },
                objects: {
                  type: 'array',
                  description: 'List of objects within the external system',
                  items: {
                    type: 'object',
                    properties: {
                      objectType: { type: 'string', description: 'Object type' },
                      externalId: { type: 'string', description: 'External ID' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    emails: {
      type: 'array',
      description: 'Related email messages associated with contacts matching this phone number',
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: "Gong's unique 32 character identifier for the email message",
          },
          from: { type: 'string', description: "The sender's email address" },
          sentTime: {
            type: 'string',
            description: 'Date and time the email was sent in ISO-8601 format',
          },
          mailbox: {
            type: 'string',
            description: 'The mailbox from which the email was retrieved',
          },
          messageHash: { type: 'string', description: 'Hash code of the email message' },
        },
      },
    },
    meetings: {
      type: 'array',
      description: 'Related meetings associated with this phone number',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: "Gong's unique identifier for the meeting" },
        },
      },
    },
    customerData: {
      type: 'array',
      description:
        'Links to data from external systems (CRM, Telephony, etc.) that reference this phone number',
      items: {
        type: 'object',
        properties: {
          system: { type: 'string', description: 'External system name' },
          objects: {
            type: 'array',
            description: 'List of objects in the external system',
            items: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description:
                    "Gong's unique numeric identifier for the Lead or Contact (up to 20 digits)",
                },
                objectType: { type: 'string', description: 'Object type' },
                externalId: { type: 'string', description: 'External ID' },
                mirrorId: { type: 'string', description: 'CRM Mirror ID' },
                fields: {
                  type: 'array',
                  description: 'Object fields',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string', description: 'Field name' },
                      value: { type: 'json', description: 'Field value' },
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
