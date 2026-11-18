import { createLogger } from '@sim/logger'
import {
  contactResourcePath,
  DEFAULT_PERSON_FIELDS,
  type GoogleContactsGetParams,
  type GoogleContactsGetResponse,
  PEOPLE_API_BASE,
  transformPerson,
} from '@/tools/google_contacts/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleContactsGet')

export const getTool: ToolConfig<GoogleContactsGetParams, GoogleContactsGetResponse> = {
  id: 'google_contacts_get',
  name: 'Google Contacts Get',
  description: 'Get a specific contact from Google Contacts',
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
  },

  request: {
    url: (params: GoogleContactsGetParams) =>
      `${PEOPLE_API_BASE}/${contactResourcePath(params.resourceName)}?personFields=${DEFAULT_PERSON_FIELDS}`,
    method: 'GET',
    headers: (params: GoogleContactsGetParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      const errorMessage = data.error?.message || 'Failed to get contact'
      logger.error('Failed to get contact', { status: response.status, error: errorMessage })
      throw new Error(errorMessage)
    }

    const contact = transformPerson(data)

    return {
      success: true,
      output: {
        content: `Retrieved contact "${contact.displayName || contact.resourceName}"`,
        metadata: contact,
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Contact retrieval confirmation message' },
    metadata: {
      type: 'json',
      description:
        'Contact details (resourceName, etag, displayName, givenName, familyName, middleName, emails, phones, organizations, addresses, biographies, urls, photos, birthdays, events, nicknames, relations, userDefined, contactGroupResourceNames)',
    },
  },
}
