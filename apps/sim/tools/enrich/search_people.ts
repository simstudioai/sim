import type { EnrichSearchPeopleParams, EnrichSearchPeopleResponse } from '@/tools/enrich/types'
import type { ToolConfig } from '@/tools/types'

export const searchPeopleTool: ToolConfig<EnrichSearchPeopleParams, EnrichSearchPeopleResponse> = {
  id: 'enrich_search_people',
  name: 'Enrich Search People',
  description:
    'Search for professionals by various criteria including name, title, skills, education, and company.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Enrich API key',
    },
    firstName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'First name',
    },
    lastName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Last name',
    },
    summary: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Professional summary keywords',
    },
    subTitle: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Job title/subtitle',
    },
    locationCountry: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Country',
    },
    locationCity: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'City',
    },
    locationState: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'State/province',
    },
    influencer: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter for influencers only',
    },
    premium: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter for premium accounts only',
    },
    language: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Primary language',
    },
    industry: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Industry',
    },
    currentJobTitles: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Current job titles (array)',
    },
    pastJobTitles: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Past job titles (array)',
    },
    skills: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Skills to search for (array)',
    },
    schoolNames: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'School names (array)',
    },
    certifications: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Certifications to filter by (array)',
    },
    degreeNames: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Degree names to filter by (array)',
    },
    studyFields: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Fields of study to filter by (array)',
    },
    currentCompanies: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Current company IDs to filter by (array of numbers)',
    },
    pastCompanies: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Past company IDs to filter by (array of numbers)',
    },
    currentPage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number (default: 1)',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page (default: 20)',
    },
  },

  request: {
    url: 'https://api.enrich.so/v1/api/search-people',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {}

      if (params.firstName) body.first_name = params.firstName
      if (params.lastName) body.last_name = params.lastName
      if (params.summary) body.summary = params.summary
      if (params.subTitle) body.sub_title = params.subTitle
      if (params.locationCountry) body.location_country = params.locationCountry
      if (params.locationCity) body.location_city = params.locationCity
      if (params.locationState) body.location_state = params.locationState
      if (params.influencer !== undefined) body.influencer = params.influencer
      if (params.premium !== undefined) body.premium = params.premium
      if (params.language) body.language = params.language
      if (params.industry) body.industry = params.industry
      if (params.currentJobTitles) body.current_job_titles = params.currentJobTitles
      if (params.pastJobTitles) body.past_job_titles = params.pastJobTitles
      if (params.skills) body.skills = params.skills
      if (params.schoolNames) body.school_names = params.schoolNames
      if (params.certifications) body.certifications = params.certifications
      if (params.degreeNames) body.degree_names = params.degreeNames
      if (params.studyFields) body.study_fields = params.studyFields
      if (params.currentCompanies) body.current_companies = params.currentCompanies
      if (params.pastCompanies) body.past_companies = params.pastCompanies
      if (params.currentPage) body.current_page = params.currentPage
      if (params.pageSize) body.page_size = params.pageSize

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const resultData = data.data ?? {}

    const profiles =
      resultData.profiles?.map((profile: any) => ({
        profileIdentifier: profile.profile_identifier ?? '',
        givenName: profile.given_name ?? null,
        familyName: profile.family_name ?? null,
        currentPosition: profile.current_position ?? null,
        profileImage: profile.profile_image ?? null,
        externalProfileUrl: profile.external_profile_url ?? null,
        city: profile.residence?.city ?? null,
        country: profile.residence?.country ?? null,
        expertSkills: profile.expert_skills ?? [],
      })) ?? []

    return {
      success: true,
      output: {
        currentPage: resultData.current_page ?? 1,
        totalPage: resultData.total_page ?? 1,
        pageSize: resultData.page_size ?? 20,
        profiles,
      },
    }
  },

  outputs: {
    currentPage: {
      type: 'number',
      description: 'Current page number',
    },
    totalPage: {
      type: 'number',
      description: 'Total number of pages',
    },
    pageSize: {
      type: 'number',
      description: 'Results per page',
    },
    profiles: {
      type: 'array',
      description: 'Search results',
      items: {
        type: 'object',
        properties: {
          profileIdentifier: { type: 'string', description: 'Profile ID' },
          givenName: { type: 'string', description: 'First name' },
          familyName: { type: 'string', description: 'Last name' },
          currentPosition: { type: 'string', description: 'Current job title' },
          profileImage: { type: 'string', description: 'Profile image URL' },
          externalProfileUrl: { type: 'string', description: 'LinkedIn URL' },
          city: { type: 'string', description: 'City' },
          country: { type: 'string', description: 'Country' },
          expertSkills: { type: 'array', description: 'Skills' },
        },
      },
    },
  },
}
