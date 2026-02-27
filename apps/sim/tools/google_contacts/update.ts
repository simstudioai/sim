import { createLogger } from '@sim/logger'
import {
  DEFAULT_PERSON_FIELDS,
  type GoogleContactsUpdateParams,
  type GoogleContactsUpdateResponse,
  PEOPLE_API_BASE,
  transformPerson,
} from '@/tools/google_contacts/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleContactsUpdate')

export const updateTool: ToolConfig<GoogleContactsUpdateParams, GoogleContactsUpdateResponse> = {
  id: 'google_contacts_update',
  name: 'Google Contacts Update',
  description: 'Update an existing contact in Google Contacts',
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
    resourceName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Resource name of the contact (e.g., people/c1234567890)',
    },
    etag: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ETag from a previous get request (required for concurrency control)',
    },
    givenName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated first name',
    },
    familyName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated last name',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated email address',
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
      description: 'Updated phone number',
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
      description: 'Updated organization/company name',
    },
    jobTitle: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated job title',
    },
    notes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated notes or biography',
    },
  },

  request: {
    url: (params: GoogleContactsUpdateParams) => {
      const updateFields: string[] = []
      if (params.givenName || params.familyName) updateFields.push('names')
      if (params.email) updateFields.push('emailAddresses')
      if (params.phone) updateFields.push('phoneNumbers')
      if (params.organization || params.jobTitle) updateFields.push('organizations')
      if (params.notes) updateFields.push('biographies')

      if (updateFields.length === 0) {
        throw new Error('At least one field to update must be provided')
      }

      const updatePersonFields = updateFields.join(',')

      return `${PEOPLE_API_BASE}/${params.resourceName.trim()}:updateContact?updatePersonFields=${updatePersonFields}&personFields=${DEFAULT_PERSON_FIELDS}`
    },
    method: 'PATCH',
    headers: (params: GoogleContactsUpdateParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params: GoogleContactsUpdateParams) => {
      const person: Record<string, any> = {
        etag: params.etag,
      }

      if (params.givenName || params.familyName) {
        person.names = [
          {
            ...(params.givenName ? { givenName: params.givenName } : {}),
            ...(params.familyName ? { familyName: params.familyName } : {}),
          },
        ]
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
      const errorMessage = data.error?.message || 'Failed to update contact'
      logger.error('Failed to update contact', { status: response.status, error: errorMessage })
      throw new Error(errorMessage)
    }

    const contact = transformPerson(data)

    return {
      success: true,
      output: {
        content: `Contact "${contact.displayName || contact.resourceName}" updated successfully`,
        metadata: contact,
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Contact update confirmation message' },
    metadata: {
      type: 'json',
      description: 'Updated contact metadata',
    },
  },
}
