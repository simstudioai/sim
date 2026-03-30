import type { ToolConfig } from '@/tools/types'
import type { ProfoundListPersonasParams, ProfoundListPersonasResponse } from './types'

export const profoundListPersonasTool: ToolConfig<
  ProfoundListPersonasParams,
  ProfoundListPersonasResponse
> = {
  id: 'profound_list_personas',
  name: 'Profound List Personas',
  description: 'List all organization personas across all categories in Profound',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Profound API Key',
    },
  },

  request: {
    url: 'https://api.tryprofound.com/v1/org/personas',
    method: 'GET',
    headers: (params) => ({
      'X-API-Key': params.apiKey,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.detail?.[0]?.msg || 'Failed to list personas')
    }
    return {
      success: true,
      output: {
        personas: (data.data ?? []).map(
          (item: {
            id: string
            name: string
            category: { id: string; name: string }
            persona: {
              behavior: { painPoints: string | null; motivations: string | null }
              employment: {
                industry: string[]
                jobTitle: string[]
                companySize: string[]
                roleSeniority: string[]
              }
              demographics: { ageRange: string[] }
            }
          }) => ({
            id: item.id ?? null,
            name: item.name ?? null,
            categoryId: item.category?.id ?? null,
            categoryName: item.category?.name ?? null,
            persona: {
              behavior: {
                painPoints: item.persona?.behavior?.painPoints ?? null,
                motivations: item.persona?.behavior?.motivations ?? null,
              },
              employment: {
                industry: item.persona?.employment?.industry ?? [],
                jobTitle: item.persona?.employment?.jobTitle ?? [],
                companySize: item.persona?.employment?.companySize ?? [],
                roleSeniority: item.persona?.employment?.roleSeniority ?? [],
              },
              demographics: {
                ageRange: item.persona?.demographics?.ageRange ?? [],
              },
            },
          })
        ),
      },
    }
  },

  outputs: {
    personas: {
      type: 'json',
      description: 'List of organization personas with profile details',
      properties: {
        id: { type: 'string', description: 'Persona ID' },
        name: { type: 'string', description: 'Persona name' },
        categoryId: { type: 'string', description: 'Category ID' },
        categoryName: { type: 'string', description: 'Category name' },
        persona: {
          type: 'json',
          description: 'Persona profile with behavior, employment, and demographics',
        },
      },
    },
  },
}
