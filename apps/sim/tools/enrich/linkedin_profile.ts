import type {
  EnrichLinkedInProfileParams,
  EnrichLinkedInProfileResponse,
} from '@/tools/enrich/types'
import type { ToolConfig } from '@/tools/types'

export const linkedInProfileTool: ToolConfig<
  EnrichLinkedInProfileParams,
  EnrichLinkedInProfileResponse
> = {
  id: 'enrich_linkedin_profile',
  name: 'Enrich LinkedIn Profile',
  description:
    'Enrich a LinkedIn profile URL with detailed information including positions, education, and social metrics.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Enrich API key',
    },
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'LinkedIn profile URL (e.g., linkedin.com/in/williamhgates)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.enrich.so/v1/api/linkedin-by-url')
      url.searchParams.append('url', params.url.trim())
      url.searchParams.append('type', 'person')
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

    const positions =
      data.position_groups?.flatMap(
        (group: any) =>
          group.profile_positions?.map((pos: any) => ({
            title: pos.title ?? '',
            company: group.company?.name ?? pos.company ?? '',
            companyLogo: group.company?.logo ?? null,
            startDate: pos.start_date ?? null,
            endDate: pos.end_date ?? null,
            location: pos.location ?? null,
          })) ?? []
      ) ?? []

    const education =
      data.education?.map((edu: any) => ({
        school: edu.school?.name ?? edu.school_name ?? '',
        degree: edu.degree_name ?? edu.degree ?? null,
        fieldOfStudy: edu.field_of_study ?? null,
        startDate: edu.start_date ?? null,
        endDate: edu.end_date ?? null,
      })) ?? []

    return {
      success: true,
      output: {
        profileId: data.profile_id ?? null,
        firstName: data.first_name ?? null,
        lastName: data.last_name ?? null,
        subTitle: data.sub_title ?? null,
        profilePicture: data.profile_picture ?? null,
        backgroundImage: data.background_image ?? null,
        industry: data.industry ?? null,
        location: data.location?.default ?? data.location ?? null,
        followersCount: data.followers_count ?? null,
        connectionsCount: data.connections_count ?? null,
        premium: data.premium ?? false,
        influencer: data.influencer ?? false,
        positions,
        education,
        websites: data.websites ?? [],
      },
    }
  },

  outputs: {
    profileId: {
      type: 'string',
      description: 'LinkedIn profile ID',
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
    subTitle: {
      type: 'string',
      description: 'Profile subtitle/headline',
      optional: true,
    },
    profilePicture: {
      type: 'string',
      description: 'Profile picture URL',
      optional: true,
    },
    backgroundImage: {
      type: 'string',
      description: 'Background image URL',
      optional: true,
    },
    industry: {
      type: 'string',
      description: 'Industry',
      optional: true,
    },
    location: {
      type: 'string',
      description: 'Location',
      optional: true,
    },
    followersCount: {
      type: 'number',
      description: 'Number of followers',
      optional: true,
    },
    connectionsCount: {
      type: 'number',
      description: 'Number of connections',
      optional: true,
    },
    premium: {
      type: 'boolean',
      description: 'Whether the account is premium',
    },
    influencer: {
      type: 'boolean',
      description: 'Whether the account is an influencer',
    },
    positions: {
      type: 'array',
      description: 'Work positions',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Job title' },
          company: { type: 'string', description: 'Company name' },
          companyLogo: { type: 'string', description: 'Company logo URL' },
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
    websites: {
      type: 'array',
      description: 'Personal websites',
      items: {
        type: 'string',
        description: 'Website URL',
      },
    },
  },
}
