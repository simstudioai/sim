import type {
  EnrichSalesPointerPeopleParams,
  EnrichSalesPointerPeopleResponse,
} from '@/tools/enrich/types'
import type { ToolConfig } from '@/tools/types'

export const salesPointerPeopleTool: ToolConfig<
  EnrichSalesPointerPeopleParams,
  EnrichSalesPointerPeopleResponse
> = {
  id: 'enrich_sales_pointer_people',
  name: 'Enrich Sales Pointer People',
  description:
    'Advanced people search with complex filters for location, company size, seniority, experience, and more.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Enrich API key',
    },
    page: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Page number (starts at 1)',
    },
    filters: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of filter objects. Each filter has type (e.g., POSTAL_CODE, COMPANY_HEADCOUNT), values (array with id, text, selectionType: INCLUDED/EXCLUDED), and optional selectedSubFilter',
    },
  },

  request: {
    url: 'https://api.enrich.so/v1/api/sales-pointer/people',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      page: params.page,
      filters: params.filters,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const resultData = data.data ?? {}

    const profiles =
      resultData.data?.map((person: any) => ({
        name:
          person.fullName ??
          person.name ??
          (person.firstName && person.lastName ? `${person.firstName} ${person.lastName}` : null),
        summary: person.summary ?? person.headline ?? null,
        location: person.location ?? person.geoRegion ?? null,
        profilePicture:
          person.profilePicture ?? person.profile_picture ?? person.profilePictureUrl ?? null,
        linkedInUrn: person.linkedInUrn ?? person.linkedin_urn ?? person.urn ?? null,
        positions: (person.positions ?? person.experience ?? []).map((pos: any) => ({
          title: pos.title ?? '',
          company: pos.companyName ?? pos.company ?? '',
        })),
        education: (person.education ?? []).map((edu: any) => ({
          school: edu.schoolName ?? edu.school ?? '',
          degree: edu.degreeName ?? edu.degree ?? null,
        })),
      })) ?? []

    return {
      success: true,
      output: {
        data: profiles,
        pagination: {
          totalCount: resultData.pagination?.total ?? 0,
          returnedCount: resultData.pagination?.returned ?? 0,
          start: resultData.pagination?.start ?? 0,
          limit: resultData.pagination?.limit ?? 0,
        },
      },
    }
  },

  outputs: {
    data: {
      type: 'array',
      description: 'People results',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Full name' },
          summary: { type: 'string', description: 'Professional summary' },
          location: { type: 'string', description: 'Location' },
          profilePicture: { type: 'string', description: 'Profile picture URL' },
          linkedInUrn: { type: 'string', description: 'LinkedIn URN' },
          positions: {
            type: 'array',
            description: 'Work positions',
            properties: {
              title: { type: 'string', description: 'Job title' },
              company: { type: 'string', description: 'Company' },
            },
          },
          education: {
            type: 'array',
            description: 'Education',
            properties: {
              school: { type: 'string', description: 'School' },
              degree: { type: 'string', description: 'Degree' },
            },
          },
        },
      },
    },
    pagination: {
      type: 'json',
      description: 'Pagination info',
      properties: {
        totalCount: { type: 'number', description: 'Total results' },
        returnedCount: { type: 'number', description: 'Returned count' },
        start: { type: 'number', description: 'Start position' },
        limit: { type: 'number', description: 'Limit' },
      },
    },
  },
}
