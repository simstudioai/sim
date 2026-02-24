import type { GongLookupEmailParams, GongLookupEmailResponse } from '@/tools/gong/types'
import type { ToolConfig } from '@/tools/types'

export const lookupEmailTool: ToolConfig<GongLookupEmailParams, GongLookupEmailResponse> = {
  id: 'gong_lookup_email',
  name: 'Gong Lookup Email',
  description:
    'Find all references to an email address in Gong (calls, email messages, meetings, CRM data, engagement).',
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
    emailAddress: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email address to look up',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.gong.io/v2/data-privacy/data-for-email-address')
      url.searchParams.set('emailAddress', params.emailAddress)
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
      throw new Error(data.errors?.[0]?.message || data.message || 'Failed to lookup email address')
    }
    return {
      success: true,
      output: {
        requestId: data.requestId ?? '',
        calls: data.calls ?? [],
        emails: data.emails ?? [],
        meetings: data.meetings ?? [],
        customerData: data.customerData ?? [],
        customerEngagement: data.customerEngagement ?? [],
      },
    }
  },

  outputs: {
    requestId: {
      type: 'string',
      description: 'Gong request reference ID for troubleshooting',
    },
    calls: {
      type: 'array',
      description: 'Related calls referencing this email address',
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
      description: 'Related email messages referencing this email address',
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
      description: 'Related meetings referencing this email address',
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
        'Links to data from external systems (CRM, Telephony, etc.) that reference this email',
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
    customerEngagement: {
      type: 'array',
      description: 'Customer engagement events (such as viewing external shared calls)',
      items: {
        type: 'object',
        properties: {
          eventType: { type: 'string', description: 'Event type' },
          eventName: { type: 'string', description: 'Event name' },
          timestamp: {
            type: 'string',
            description: 'Date and time the event occurred in ISO-8601 format',
          },
          contentId: { type: 'string', description: 'Event content ID' },
          contentUrl: { type: 'string', description: 'Event content URL' },
          reportingSystem: { type: 'string', description: 'Event reporting system' },
          sourceEventId: { type: 'string', description: 'Source event ID' },
        },
      },
    },
  },
}
