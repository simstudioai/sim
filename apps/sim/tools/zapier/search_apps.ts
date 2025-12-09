import type { ToolConfig } from '@/tools/types'
import type { ZapierSearchAppsParams, ZapierSearchAppsResponse } from '@/tools/zapier/types'

export const zapierSearchAppsTool: ToolConfig<ZapierSearchAppsParams, ZapierSearchAppsResponse> = {
  id: 'zapier_search_apps',
  name: 'Zapier Search Apps',
  description:
    'Search for apps available in Zapier. Returns apps with their available action counts.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Zapier AI Actions API key from actions.zapier.com/credentials',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional search query to filter apps by name',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = 'https://actions.zapier.com/api/v2/apps/search/'
      if (params.query) {
        return `${baseUrl}?query=${encodeURIComponent(params.query)}`
      }
      return baseUrl
    },
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || data.detail || `Zapier API error: ${response.status}`)
    }

    const apps = Array.isArray(data) ? data : data.results || []

    return {
      success: true,
      output: {
        apps: apps.map((app: any) => {
          // The API returns an 'actions' dictionary with action type counts
          // Keys can be: write, search, read, read_bulk, search_or_write, search_and_write
          const actions = app.actions || {}

          // Sum all action counts
          const actionCount =
            typeof actions === 'object'
              ? Object.values(actions).reduce(
                  (sum: number, count: any) => sum + (typeof count === 'number' ? count : 0),
                  0
                )
              : 0

          // Sum write-type actions (write, search_or_write, search_and_write)
          const writeActionCount =
            (actions.write || 0) + (actions.search_or_write || 0) + (actions.search_and_write || 0)

          // Sum search-type actions (search, search_or_write, search_and_write)
          const searchActionCount =
            (actions.search || 0) + (actions.search_or_write || 0) + (actions.search_and_write || 0)

          // Sum read-type actions (read, read_bulk)
          const readActionCount = (actions.read || 0) + (actions.read_bulk || 0)

          return {
            app: app.app || '',
            name: app.name || '',
            logoUrl: app.logo_url || '',
            authType: app.auth_type ?? null,
            actions,
            actionCount,
            writeActionCount,
            searchActionCount,
            readActionCount,
          }
        }),
      },
    }
  },

  outputs: {
    apps: {
      type: 'json',
      description:
        'Array of apps with app, name, logoUrl, authType, actions (raw counts by type), actionCount, writeActionCount, searchActionCount, readActionCount',
    },
  },
}
