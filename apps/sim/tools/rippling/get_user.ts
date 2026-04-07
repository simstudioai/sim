import type { RipplingGetUserParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingGetUserTool: ToolConfig<RipplingGetUserParams> = {
  id: 'rippling_get_user',
  name: 'Rippling Get User',
  description: 'Get a specific user by ID',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    id: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Resource ID' },
  },
  request: {
    url: (params) => `https://rest.ripplingapis.com/users/${encodeURIComponent(params.id.trim())}/`,
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
        active: (data.active as boolean) ?? null,
        username: (data.username as string) ?? null,
        display_name: (data.display_name as string) ?? null,
        preferred_language: (data.preferred_language as string) ?? null,
        locale: (data.locale as string) ?? null,
        timezone: (data.timezone as string) ?? null,
        number: (data.number as string) ?? null,
        name: data.name ?? null,
        emails: data.emails ?? [],
        phone_numbers: data.phone_numbers ?? [],
        addresses: data.addresses ?? [],
        photos: data.photos ?? [],
        __meta: data.__meta ?? null,
      },
    }
  },
  outputs: {
    id: { type: 'string', description: 'User ID' },
    created_at: { type: 'string', description: 'Creation date', optional: true },
    updated_at: { type: 'string', description: 'Update date', optional: true },
    active: { type: 'boolean', description: 'Is active', optional: true },
    username: { type: 'string', description: 'Username', optional: true },
    display_name: { type: 'string', description: 'Display name', optional: true },
    preferred_language: { type: 'string', description: 'Preferred language', optional: true },
    locale: { type: 'string', description: 'Locale', optional: true },
    timezone: { type: 'string', description: 'Timezone', optional: true },
    number: { type: 'string', description: 'Profile number', optional: true },
    name: { type: 'json', description: 'User name object', optional: true },
    emails: { type: 'json', description: 'Email addresses', optional: true },
    phone_numbers: { type: 'json', description: 'Phone numbers', optional: true },
    addresses: { type: 'json', description: 'Addresses', optional: true },
    photos: { type: 'json', description: 'Photos', optional: true },
    __meta: { type: 'json', description: 'Metadata including redacted_fields', optional: true },
  },
}
