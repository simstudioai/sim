import type { GongGetUserParams, GongGetUserResponse } from '@/tools/gong/types'
import type { ToolConfig } from '@/tools/types'

export const getUserTool: ToolConfig<GongGetUserParams, GongGetUserResponse> = {
  id: 'gong_get_user',
  name: 'Gong Get User',
  description: 'Retrieve details for a specific user from Gong.',
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
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Gong user ID to retrieve',
    },
  },

  request: {
    url: (params) => `https://api.gong.io/v2/users/${params.userId}`,
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.accessKey}:${params.accessKeySecret}`)}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.errors?.[0]?.message || data.message || 'Failed to get user')
    }
    const user = data.user ?? data
    return {
      success: true,
      output: {
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
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Unique numeric user ID (up to 20 digits)' },
    emailAddress: { type: 'string', description: 'User email address', optional: true },
    created: { type: 'string', description: 'User creation timestamp (ISO-8601)', optional: true },
    active: { type: 'boolean', description: 'Whether the user is active' },
    emailAliases: {
      type: 'array',
      description: 'Alternative email addresses for the user',
      optional: true,
      items: { type: 'string' },
    },
    trustedEmailAddress: {
      type: 'string',
      description: 'Trusted email address for the user',
      optional: true,
    },
    firstName: { type: 'string', description: 'First name', optional: true },
    lastName: { type: 'string', description: 'Last name', optional: true },
    title: { type: 'string', description: 'Job title', optional: true },
    phoneNumber: { type: 'string', description: 'Phone number', optional: true },
    extension: { type: 'string', description: 'Phone extension number', optional: true },
    personalMeetingUrls: {
      type: 'array',
      description: 'Personal meeting URLs',
      optional: true,
      items: { type: 'string' },
    },
    settings: {
      type: 'object',
      description: 'User settings',
      optional: true,
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
        preventEmailImport: { type: 'boolean', description: 'Whether email import is prevented' },
        nonRecordedMeetingsImported: {
          type: 'boolean',
          description: 'Whether non-recorded meetings are imported',
        },
        gongConnectEnabled: { type: 'boolean', description: 'Whether Gong Connect is enabled' },
      },
    },
    managerId: { type: 'string', description: 'Manager user ID', optional: true },
    meetingConsentPageUrl: {
      type: 'string',
      description: 'Meeting consent page URL',
      optional: true,
    },
    spokenLanguages: {
      type: 'array',
      description: 'Languages spoken by the user',
      optional: true,
      items: {
        type: 'object',
        properties: {
          language: { type: 'string', description: 'Language code' },
          primary: { type: 'boolean', description: 'Whether this is the primary language' },
        },
      },
    },
  },
}
