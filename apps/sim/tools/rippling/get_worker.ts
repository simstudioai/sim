import type { RipplingGetWorkerParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingGetWorkerTool: ToolConfig<RipplingGetWorkerParams> = {
  id: 'rippling_get_worker',
  name: 'Rippling Get Worker',
  description: 'Get a specific worker by ID',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    id: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Resource ID' },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated fields to expand',
    },
  },
  request: {
    url: (params) => {
      const base = `https://rest.ripplingapis.com/workers/${encodeURIComponent(params.id.trim())}/`
      if (params.expand != null) return `${base}?expand=${encodeURIComponent(params.expand)}`
      return base
    },
    method: 'GET',
    headers: (params) => ({ Authorization: `Bearer ${params.apiKey}`, Accept: 'application/json' }),
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Rippling API error (${response.status}): ${errorText}`)
    }
    const data = await response.json()
    return {
      success: true,
      output: {
        id: (data.id as string) ?? '',
        created_at: (data.created_at as string) ?? null,
        updated_at: (data.updated_at as string) ?? null,
        user_id: (data.user_id as string) ?? null,
        is_manager: (data.is_manager as boolean) ?? null,
        manager_id: (data.manager_id as string) ?? null,
        legal_entity_id: (data.legal_entity_id as string) ?? null,
        country: (data.country as string) ?? null,
        start_date: (data.start_date as string) ?? null,
        end_date: (data.end_date as string) ?? null,
        number: (data.number as number) ?? null,
        work_email: (data.work_email as string) ?? null,
        personal_email: (data.personal_email as string) ?? null,
        status: (data.status as string) ?? null,
        employment_type_id: (data.employment_type_id as string) ?? null,
        department_id: (data.department_id as string) ?? null,
        teams_id: (data.teams_id as unknown[]) ?? [],
        title: (data.title as string) ?? null,
        level_id: (data.level_id as string) ?? null,
        compensation_id: (data.compensation_id as string) ?? null,
        overtime_exemption: (data.overtime_exemption as string) ?? null,
        title_effective_date: (data.title_effective_date as string) ?? null,
        business_partners_id: (data.business_partners_id as unknown[]) ?? [],
        location: data.location ?? null,
        gender: (data.gender as string) ?? null,
        date_of_birth: (data.date_of_birth as string) ?? null,
        race: (data.race as string) ?? null,
        ethnicity: (data.ethnicity as string) ?? null,
        citizenship: (data.citizenship as string) ?? null,
        termination_details: data.termination_details ?? null,
        custom_fields: data.custom_fields ?? null,
        country_fields: data.country_fields ?? null,
        __meta: data.__meta ?? null,
      },
    }
  },
  outputs: {
    id: { type: 'string', description: 'Worker ID' },
    created_at: { type: 'string', description: 'Creation date', optional: true },
    updated_at: { type: 'string', description: 'Update date', optional: true },
    user_id: { type: 'string', description: 'User ID', optional: true },
    is_manager: { type: 'boolean', description: 'Is manager', optional: true },
    manager_id: { type: 'string', description: 'Manager ID', optional: true },
    legal_entity_id: { type: 'string', description: 'Legal entity ID', optional: true },
    country: { type: 'string', description: 'Country', optional: true },
    start_date: { type: 'string', description: 'Start date', optional: true },
    end_date: { type: 'string', description: 'End date', optional: true },
    number: { type: 'number', description: 'Worker number', optional: true },
    work_email: { type: 'string', description: 'Work email', optional: true },
    personal_email: { type: 'string', description: 'Personal email', optional: true },
    status: { type: 'string', description: 'Status', optional: true },
    employment_type_id: { type: 'string', description: 'Employment type ID', optional: true },
    department_id: { type: 'string', description: 'Department ID', optional: true },
    teams_id: { type: 'json', description: 'Team IDs', optional: true },
    title: { type: 'string', description: 'Job title', optional: true },
    level_id: { type: 'string', description: 'Level ID', optional: true },
    compensation_id: { type: 'string', description: 'Compensation ID', optional: true },
    overtime_exemption: { type: 'string', description: 'Overtime exemption', optional: true },
    title_effective_date: { type: 'string', description: 'Title effective date', optional: true },
    business_partners_id: { type: 'json', description: 'Business partner IDs', optional: true },
    location: { type: 'json', description: 'Worker location', optional: true },
    gender: { type: 'string', description: 'Gender', optional: true },
    date_of_birth: { type: 'string', description: 'Date of birth', optional: true },
    race: { type: 'string', description: 'Race', optional: true },
    ethnicity: { type: 'string', description: 'Ethnicity', optional: true },
    citizenship: { type: 'string', description: 'Citizenship', optional: true },
    termination_details: { type: 'json', description: 'Termination details', optional: true },
    custom_fields: { type: 'json', description: 'Custom fields', optional: true },
    country_fields: { type: 'json', description: 'Country-specific fields', optional: true },
    __meta: { type: 'json', description: 'Metadata including redacted_fields', optional: true },
  },
}
