import { ErrorExtractorId } from '@/tools/error-extractors'
import type { SplunkListAppsParams, SplunkListAppsResponse } from '@/tools/splunk/types'
import {
  asBoolean,
  asString,
  buildSplunkHeaders,
  buildSplunkUrl,
  getEntryContent,
  getEntryName,
  getSplunkEntries,
  getSplunkPaging,
  SPLUNK_CONNECTION_PARAMS,
} from '@/tools/splunk/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Lists locally installed apps. The app name doubles as the `app` namespace value
 * accepted by every other Splunk tool, so this is how a workflow discovers which
 * namespaces it can address.
 */
export const listAppsTool: ToolConfig<SplunkListAppsParams, SplunkListAppsResponse> = {
  id: 'splunk_list_apps',
  name: 'Splunk List Apps',
  description:
    'List the apps installed on the Splunk instance with their label, version, author, and enabled state.',
  version: '1.0.0',

  params: {
    ...SPLUNK_CONNECTION_PARAMS,
    count: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of apps to return (e.g. 50). 0 returns all.',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Index of the first app to return, for pagination',
    },
  },

  request: {
    url: (params) =>
      buildSplunkUrl(params, '/apps/local', { count: params.count, offset: params.offset }),
    method: 'GET',
    headers: (params) => buildSplunkHeaders(params),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const paging = getSplunkPaging(data)
    return {
      success: true,
      output: {
        apps: getSplunkEntries(data).map((entry) => {
          const content = getEntryContent(entry)
          return {
            name: getEntryName(entry),
            id: asString(entry.id),
            updated: asString(entry.updated),
            label: asString(content.label),
            version: asString(content.version),
            author: asString(content.author),
            description: asString(content.description),
            details: asString(content.details),
            disabled: asBoolean(content.disabled),
            visible: asBoolean(content.visible),
            configured: asBoolean(content.configured),
            checkForUpdates: asBoolean(content.check_for_updates),
            stateChangeRequiresRestart: asBoolean(content.state_change_requires_restart),
          }
        }),
        total: paging.total,
        offset: paging.offset,
      },
    }
  },

  errorExtractor: ErrorExtractorId.SPLUNK_ERRORS,

  /** `total`/`offset` inline by necessity — see the note on `runSearchTool.outputs`. */
  outputs: {
    apps: {
      type: 'array',
      description: 'Apps installed on the Splunk instance',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'App directory name, usable as the app namespace' },
          id: { type: 'string', description: 'Fully qualified REST URI of the app' },
          updated: { type: 'string', description: 'Last update timestamp' },
          label: { type: 'string', description: 'Display name of the app', optional: true },
          version: { type: 'string', description: 'App version', optional: true },
          author: { type: 'string', description: 'App author', optional: true },
          description: { type: 'string', description: 'App description', optional: true },
          details: {
            type: 'string',
            description: 'URL with detailed information about the app',
            optional: true,
          },
          disabled: { type: 'boolean', description: 'Whether the app is disabled' },
          visible: {
            type: 'boolean',
            description: 'Whether the app is visible and navigable from Splunk Web',
          },
          configured: {
            type: 'boolean',
            description: 'Whether the custom app setup has been completed',
            optional: true,
          },
          checkForUpdates: {
            type: 'boolean',
            description: 'Whether Splunkbase is checked for app updates',
            optional: true,
          },
          stateChangeRequiresRestart: {
            type: 'boolean',
            description: 'Whether changing the app state requires a restart',
            optional: true,
          },
        },
      },
    },
    total: {
      type: 'number',
      description:
        'Total number of entries matching the request, from the response paging envelope. Compare with offset to decide whether another page remains.',
      optional: true,
    },
    offset: {
      type: 'number',
      description:
        'Offset of the first entry in this page, echoed from the response paging envelope',
      optional: true,
    },
  },
}
