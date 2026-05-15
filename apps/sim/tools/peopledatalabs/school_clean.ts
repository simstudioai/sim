import type { PdlCleanSchoolParams, PdlCleanSchoolResponse } from '@/tools/peopledatalabs/types'
import { PDL_SCHOOL_OUTPUT_PROPERTIES } from '@/tools/peopledatalabs/types'
import { projectSchool } from '@/tools/peopledatalabs/utils'
import type { ToolConfig } from '@/tools/types'

export const cleanSchoolTool: ToolConfig<PdlCleanSchoolParams, PdlCleanSchoolResponse> = {
  id: 'pdl_clean_school',
  name: 'PDL School Cleaner',
  description:
    'Normalize a school string into a canonical school record. Provide at least one of name, website, or profile (LinkedIn URL).',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'People Data Labs API key',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Raw school name to normalize',
    },
    website: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'School website',
    },
    profile: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'LinkedIn school URL',
    },
  },

  request: {
    url: () => 'https://api.peopledatalabs.com/v5/school/clean',
    method: 'POST',
    headers: (params) => ({
      'X-Api-Key': params.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.name) body.name = params.name
      if (params.website) body.website = params.website
      if (params.profile) body.profile = params.profile
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = (await response.json()) as Record<string, unknown>
    const status = (data.status as number) ?? response.status

    if (status === 404) {
      return { success: true, output: { matched: false, school: null } }
    }

    if (!response.ok) {
      const error = (data.error as { message?: string })?.message
      throw new Error(error || `People Data Labs error: ${response.status}`)
    }

    const hasFields = data.name || data.website || data.id
    return {
      success: true,
      output: {
        matched: Boolean(hasFields),
        school: hasFields ? projectSchool(data) : null,
      },
    }
  },

  outputs: {
    matched: { type: 'boolean', description: 'Whether the input was matched to a known school' },
    school: {
      type: 'object',
      description: 'Canonical school record',
      optional: true,
      properties: PDL_SCHOOL_OUTPUT_PROPERTIES,
    },
  },
}
