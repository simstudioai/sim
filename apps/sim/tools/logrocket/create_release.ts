import type {
  LogRocketCreateReleaseParams,
  LogRocketCreateReleaseResponse,
} from '@/tools/logrocket/types'
import { buildAppUrl, buildAuthHeaders, throwOnError } from '@/tools/logrocket/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Registers a release so LogRocket can match uploaded source maps to it.
 *
 * This endpoint is not covered by the prose docs; its path, body, and 409
 * duplicate semantics come from LogRocket's own open-source CLI, which calls it
 * for `logrocket release <version>`.
 * See https://github.com/LogRocket/logrocket-cli (`src/apiClient.js`,
 * `src/commands/release.js`). The CLI never reads the response body, so this
 * tool reports only what the status line proves rather than inventing fields.
 */
export const createReleaseTool: ToolConfig<
  LogRocketCreateReleaseParams,
  LogRocketCreateReleaseResponse
> = {
  id: 'logrocket_create_release',
  name: 'LogRocket Create Release',
  description:
    'Register a release version in LogRocket so uploaded source maps can decode stack traces for it. Fails with a conflict if the version already exists.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'LogRocket API key',
    },
    orgId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'LogRocket organization ID',
    },
    appId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'LogRocket project (app) ID',
    },
    apiHost: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'API host override for Private Cloud deployments',
    },
    version: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Release version to register, e.g. 1.2.3 or a commit SHA',
    },
  },

  request: {
    url: (params) => buildAppUrl(params, 'releases/').toString(),
    method: 'POST',
    headers: (params) => ({
      ...buildAuthHeaders(params.apiKey),
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }),
    body: (params) => ({ version: params.version.trim() }),
  },

  /**
   * The executor rejects any non-2xx before this runs, so a duplicate version
   * (HTTP 409) surfaces as a tool error rather than a quiet no-op, and reaching
   * here means the release was registered. Only the echoed version is reported —
   * the CLI never reads the response body, so its shape is unverified and
   * nothing is invented here.
   */
  transformResponse: async (response: Response, params) => {
    await throwOnError(response, 'LogRocket Releases API')

    return {
      success: true,
      output: {
        version: params?.version?.trim() ?? '',
      },
    }
  },

  outputs: {
    version: {
      type: 'string',
      description: 'Release version that was registered',
    },
  },
}
