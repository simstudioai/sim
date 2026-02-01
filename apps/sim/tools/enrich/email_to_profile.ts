import type { EnrichEmailToProfileParams, EnrichEmailToProfileResponse } from '@/tools/enrich/types'
import type { ToolConfig } from '@/tools/types'

export const emailToProfileTool: ToolConfig<
  EnrichEmailToProfileParams,
  EnrichEmailToProfileResponse
> = {
  id: 'enrich_email_to_profile',
  name: 'Enrich Email to Profile',
  description:
    'Retrieve detailed LinkedIn profile information using an email address including work history, education, and skills.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Enrich API key',
    },
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email address to look up (e.g., john.doe@company.com)',
    },
    inRealtime: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set to true to retrieve fresh data, bypassing cached information',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.enrich.so/v1/api/person')
      url.searchParams.append('email', params.email.trim())
      if (params.inRealtime !== undefined) {
        url.searchParams.append('in_realtime', String(params.inRealtime))
      }
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    const positionHistory =
      data.positionHistory?.map((pos: any) => ({
        title: pos.title ?? '',
        company: pos.companyName ?? pos.company ?? '',
        startDate: pos.startDate ?? null,
        endDate: pos.endDate ?? null,
        location: pos.location ?? null,
      })) ?? []

    const education =
      data.schools?.map((edu: any) => ({
        school: edu.schoolName ?? edu.school ?? '',
        degree: edu.degree ?? null,
        fieldOfStudy: edu.fieldOfStudy ?? null,
        startDate: edu.startDate ?? null,
        endDate: edu.endDate ?? null,
      })) ?? []

    const certifications =
      data.certifications?.map((cert: any) => ({
        name: cert.name ?? '',
        authority: cert.authority ?? null,
        url: cert.url ?? null,
      })) ?? []

    return {
      success: true,
      output: {
        displayName: data.displayName ?? null,
        firstName: data.firstName ?? null,
        lastName: data.lastName ?? null,
        headline: data.headline ?? null,
        occupation: data.occupation ?? null,
        summary: data.summary ?? null,
        location: data.location ?? null,
        country: data.country ?? null,
        linkedInUrl: data.linkedInUrl ?? null,
        photoUrl: data.photoUrl ?? null,
        connectionCount: data.connectionCount ?? null,
        isConnectionCountObfuscated: data.isConnectionCountObfuscated ?? null,
        positionHistory,
        education,
        certifications,
        skills: data.skills ?? [],
        languages: data.languages ?? [],
        locale: data.locale ?? null,
        version: data.version ?? null,
      },
    }
  },

  outputs: {
    displayName: {
      type: 'string',
      description: 'Full display name',
      optional: true,
    },
    firstName: {
      type: 'string',
      description: 'First name',
      optional: true,
    },
    lastName: {
      type: 'string',
      description: 'Last name',
      optional: true,
    },
    headline: {
      type: 'string',
      description: 'Professional headline',
      optional: true,
    },
    occupation: {
      type: 'string',
      description: 'Current occupation',
      optional: true,
    },
    summary: {
      type: 'string',
      description: 'Profile summary',
      optional: true,
    },
    location: {
      type: 'string',
      description: 'Location',
      optional: true,
    },
    country: {
      type: 'string',
      description: 'Country',
      optional: true,
    },
    linkedInUrl: {
      type: 'string',
      description: 'LinkedIn profile URL',
      optional: true,
    },
    photoUrl: {
      type: 'string',
      description: 'Profile photo URL',
      optional: true,
    },
    connectionCount: {
      type: 'number',
      description: 'Number of connections',
      optional: true,
    },
    isConnectionCountObfuscated: {
      type: 'boolean',
      description: 'Whether connection count is obfuscated (500+)',
      optional: true,
    },
    positionHistory: {
      type: 'array',
      description: 'Work experience history',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Job title' },
          company: { type: 'string', description: 'Company name' },
          startDate: { type: 'string', description: 'Start date' },
          endDate: { type: 'string', description: 'End date' },
          location: { type: 'string', description: 'Location' },
        },
      },
    },
    education: {
      type: 'array',
      description: 'Education history',
      items: {
        type: 'object',
        properties: {
          school: { type: 'string', description: 'School name' },
          degree: { type: 'string', description: 'Degree' },
          fieldOfStudy: { type: 'string', description: 'Field of study' },
          startDate: { type: 'string', description: 'Start date' },
          endDate: { type: 'string', description: 'End date' },
        },
      },
    },
    certifications: {
      type: 'array',
      description: 'Professional certifications',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Certification name' },
          authority: { type: 'string', description: 'Issuing authority' },
          url: { type: 'string', description: 'Certification URL' },
        },
      },
    },
    skills: {
      type: 'array',
      description: 'List of skills',
      items: {
        type: 'string',
        description: 'Skill',
      },
    },
    languages: {
      type: 'array',
      description: 'List of languages',
      items: {
        type: 'string',
        description: 'Language',
      },
    },
    locale: {
      type: 'string',
      description: 'Profile locale (e.g., en_US)',
      optional: true,
    },
    version: {
      type: 'number',
      description: 'Profile version number',
      optional: true,
    },
  },
}
