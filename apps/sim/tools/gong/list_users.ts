import type { GongListUsersParams, GongListUsersResponse } from '@/tools/gong/types'
import type { ToolConfig } from '@/tools/types'

export const listUsersTool: ToolConfig<GongListUsersParams, GongListUsersResponse> = {
  id: 'gong_list_users',
  name: 'Gong List Users',
  description: 'List all users in your Gong account.',
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
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response',
    },
    includeAvatars: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to include avatar URLs (true/false)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.gong.io/v2/users')
      if (params.cursor) url.searchParams.set('cursor', params.cursor)
      if (params.includeAvatars) url.searchParams.set('includeAvatars', params.includeAvatars)
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
      throw new Error(data.errors?.[0]?.message || data.message || 'Failed to list users')
    }
    const users = (data.users ?? []).map((user: Record<string, unknown>) => ({
      id: user.id ?? '',
      emailAddress: user.emailAddress ?? null,
      created: user.created ?? null,
      active: user.active ?? false,
      emailAliases: user.emailAliases ?? [],
      trustedEmailAddress: user.trustedEmailAddress ?? null,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      title: user.title ?? null,
      phoneNumber: user.phoneNumber ?? null,
      extension: user.extension ?? null,
      personalMeetingUrls: user.personalMeetingUrls ?? [],
      settings: user.settings ?? null,
      managerId: user.managerId ?? null,
      meetingConsentPageUrl: user.meetingConsentPageUrl ?? null,
      spokenLanguages: user.spokenLanguages ?? [],
    }))
    return {
      success: true,
      output: {
        users,
        cursor: data.records?.cursor ?? null,
        totalRecords: data.records?.totalRecords ?? null,
        currentPageSize: data.records?.currentPageSize ?? null,
        currentPageNumber: data.records?.currentPageNumber ?? null,
      },
    }
  },

  outputs: {
    users: {
      type: 'array',
      description: 'List of Gong users',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique numeric user ID (up to 20 digits)' },
          emailAddress: { type: 'string', description: 'User email address' },
          created: { type: 'string', description: 'User creation timestamp (ISO-8601)' },
          active: { type: 'boolean', description: 'Whether the user is active' },
          emailAliases: {
            type: 'array',
            description: 'Alternative email addresses for the user',
            items: { type: 'string' },
          },
          trustedEmailAddress: {
            type: 'string',
            description: 'Trusted email address for the user',
          },
          firstName: { type: 'string', description: 'First name' },
          lastName: { type: 'string', description: 'Last name' },
          title: { type: 'string', description: 'Job title' },
          phoneNumber: { type: 'string', description: 'Phone number' },
          extension: { type: 'string', description: 'Phone extension number' },
          personalMeetingUrls: {
            type: 'array',
            description: 'Personal meeting URLs',
            items: { type: 'string' },
          },
          settings: {
            type: 'object',
            description: 'User settings',
            properties: {
              webConferencesRecorded: {
                type: 'boolean',
                description: 'Whether web conferences are recorded',
              },
              preventWebConferenceRecording: {
                type: 'boolean',
                description: 'Whether web conference recording is prevented',
              },
              telephonyCallsImported: {
                type: 'boolean',
                description: 'Whether telephony calls are imported',
              },
              emailsImported: { type: 'boolean', description: 'Whether emails are imported' },
              preventEmailImport: {
                type: 'boolean',
                description: 'Whether email import is prevented',
              },
              nonRecordedMeetingsImported: {
                type: 'boolean',
                description: 'Whether non-recorded meetings are imported',
              },
              gongConnectEnabled: {
                type: 'boolean',
                description: 'Whether Gong Connect is enabled',
              },
            },
          },
          managerId: { type: 'string', description: 'Manager user ID' },
          meetingConsentPageUrl: { type: 'string', description: 'Meeting consent page URL' },
          spokenLanguages: {
            type: 'array',
            description: 'Languages spoken by the user',
            items: {
              type: 'object',
              properties: {
                language: { type: 'string', description: 'Language code' },
                primary: { type: 'boolean', description: 'Whether this is the primary language' },
              },
            },
          },
        },
      },
    },
    cursor: { type: 'string', description: 'Pagination cursor for the next page', optional: true },
    totalRecords: { type: 'number', description: 'Total number of user records', optional: true },
    currentPageSize: {
      type: 'number',
      description: 'Number of records in the current page',
      optional: true,
    },
    currentPageNumber: { type: 'number', description: 'Current page number', optional: true },
  },
}
