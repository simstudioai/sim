import type { ToolConfig } from '@/tools/types'
import type { ProfoundCategoryPersonasParams, ProfoundCategoryPersonasResponse } from './types'

export const profoundCategoryPersonasTool: ToolConfig<
  ProfoundCategoryPersonasParams,
  ProfoundCategoryPersonasResponse
> = {
  id: 'profound_category_personas',
  name: 'Profound Category Personas',
  description: 'List personas for a specific category in Profound',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Profound API Key',
    },
    categoryId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Category ID (UUID)',
    },
  },

  request: {
    url: (params) =>
      `https://api.tryprofound.com/v1/org/categories/${encodeURIComponent(params.categoryId)}/personas`,
    method: 'GET',
    headers: (params) => ({
      'X-API-Key': params.apiKey,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.detail?.[0]?.msg || 'Failed to list category personas')
    }
    return {
      success: true,
      output: {
        personas: (data.data ?? []).map(
          (item: {
            id: string
            name: string
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
      description: 'List of personas in the category',
      properties: {
        id: { type: 'string', description: 'Persona ID' },
        name: { type: 'string', description: 'Persona name' },
        persona: {
          type: 'json',
          description: 'Persona profile with behavior, employment, and demographics',
        },
      },
    },
  },
}
