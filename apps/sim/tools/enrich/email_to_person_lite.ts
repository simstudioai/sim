import type {
  EnrichEmailToPersonLiteParams,
  EnrichEmailToPersonLiteResponse,
} from '@/tools/enrich/types'
import type { ToolConfig } from '@/tools/types'

export const emailToPersonLiteTool: ToolConfig<
  EnrichEmailToPersonLiteParams,
  EnrichEmailToPersonLiteResponse
> = {
  id: 'enrich_email_to_person_lite',
  name: 'Enrich Email to Person Lite',
  description:
    'Retrieve basic LinkedIn profile information from an email address. A lighter version with essential data only.',
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
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.enrich.so/v1/api/email-to-linkedin-lite')
      url.searchParams.append('email', params.email.trim())
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

    return {
      success: true,
      output: {
        name: data.name ?? null,
        firstName: data.first_name ?? data.firstName ?? null,
        lastName: data.last_name ?? data.lastName ?? null,
        email: data.email ?? null,
        title: data.title ?? null,
        location: data.location ?? null,
        company: data.company ?? null,
        companyLocation: data.company_location ?? data.companyLocation ?? null,
        companyLinkedIn: data.company_linkedin ?? data.companyLinkedIn ?? null,
        profileId: data.profile_id ?? data.profileId ?? null,
        schoolName: data.school_name ?? data.schoolName ?? null,
        schoolUrl: data.school_url ?? data.schoolUrl ?? null,
        linkedInUrl: data.linkedin_url ?? data.linkedInUrl ?? null,
        photoUrl: data.photo_url ?? data.photoUrl ?? null,
        followerCount: data.follower_count ?? data.followerCount ?? null,
        connectionCount: data.connection_count ?? data.connectionCount ?? null,
        languages: data.languages ?? [],
        projects: data.projects ?? [],
        certifications: data.certifications ?? [],
        volunteerExperience: data.volunteer_experience ?? data.volunteerExperience ?? [],
      },
    }
  },

  outputs: {
    name: {
      type: 'string',
      description: 'Full name',
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
    email: {
      type: 'string',
      description: 'Email address',
      optional: true,
    },
    title: {
      type: 'string',
      description: 'Job title',
      optional: true,
    },
    location: {
      type: 'string',
      description: 'Location',
      optional: true,
    },
    company: {
      type: 'string',
      description: 'Current company',
      optional: true,
    },
    companyLocation: {
      type: 'string',
      description: 'Company location',
      optional: true,
    },
    companyLinkedIn: {
      type: 'string',
      description: 'Company LinkedIn URL',
      optional: true,
    },
    profileId: {
      type: 'string',
      description: 'LinkedIn profile ID',
      optional: true,
    },
    schoolName: {
      type: 'string',
      description: 'School name',
      optional: true,
    },
    schoolUrl: {
      type: 'string',
      description: 'School URL',
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
    followerCount: {
      type: 'number',
      description: 'Number of followers',
      optional: true,
    },
    connectionCount: {
      type: 'number',
      description: 'Number of connections',
      optional: true,
    },
    languages: {
      type: 'array',
      description: 'Languages spoken',
      items: { type: 'string', description: 'Language' },
    },
    projects: {
      type: 'array',
      description: 'Projects',
      items: { type: 'string', description: 'Project' },
    },
    certifications: {
      type: 'array',
      description: 'Certifications',
      items: { type: 'string', description: 'Certification' },
    },
    volunteerExperience: {
      type: 'array',
      description: 'Volunteer experience',
      items: { type: 'string', description: 'Volunteer role' },
    },
  },
}
