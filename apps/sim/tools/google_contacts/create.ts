import { createLogger } from '@sim/logger'
import {
  DEFAULT_PERSON_FIELDS,
  type GoogleContactsCreateParams,
  type GoogleContactsCreateResponse,
  PEOPLE_API_BASE,
  transformPerson,
} from '@/tools/google_contacts/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleContactsCreate')

export const createTool: ToolConfig<GoogleContactsCreateParams, GoogleContactsCreateResponse> = {
  id: 'google_contacts_create',
  name: 'Google Contacts Create',
  description: 'Create a new contact in Google Contacts',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-contacts',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token for Google People API',
    },
    givenName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'First name of the contact',
    },
    familyName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Last name of the contact',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email address of the contact',
    },
    emailType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email type: home, work, or other',
    },
    phone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Phone number of the contact',
    },
    phoneType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Phone type: mobile, home, work, or other',
    },
    organization: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Organization/company name',
    },
    jobTitle: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Job title at the organization',
    },
    notes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Notes or biography for the contact',
    },
  },

  request: {
    url: () => `${PEOPLE_API_BASE}/people:createContact?personFields=${DEFAULT_PERSON_FIELDS}`,
    method: 'POST',
    headers: (params: GoogleContactsCreateParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params: GoogleContactsCreateParams) => {
      const person: Record<string, any> = {
        names: [
          {
            givenName: params.givenName,
            ...(params.familyName ? { familyName: params.familyName } : {}),
          },
        ],
      }

      if (params.email) {
        person.emailAddresses = [{ value: params.email, type: params.emailType || 'other' }]
      }

      if (params.phone) {
        person.phoneNumbers = [{ value: params.phone, type: params.phoneType || 'mobile' }]
      }

      if (params.organization || params.jobTitle) {
        person.organizations = [
          {
            ...(params.organization ? { name: params.organization } : {}),
            ...(params.jobTitle ? { title: params.jobTitle } : {}),
          },
        ]
      }

      if (params.notes) {
        person.biographies = [{ value: params.notes, contentType: 'TEXT_PLAIN' }]
      }

      return person
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      const errorMessage = data.error?.message || 'Failed to create contact'
      logger.error('Failed to create contact', { status: response.status, error: errorMessage })
      throw new Error(errorMessage)
    }

    const contact = transformPerson(data)

    return {
      success: true,
      output: {
        content: `Contact "${contact.displayName || contact.givenName}" created successfully`,
        metadata: contact,
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Contact creation confirmation message' },
    metadata: {
      type: 'json',
      description: 'Created contact metadata including resource name and details',
    },
  },
}
