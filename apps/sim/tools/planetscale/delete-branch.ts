import type {
  PlanetScaleDeleteBranchParams,
  PlanetScaleToolResponse,
} from '@/tools/planetscale/types'
import {
  optionalPlanetScaleBoolean,
  planetScaleApiUrl,
  planetScaleHeaders,
} from '@/tools/planetscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'
export const planetScaleDeleteBranchTool: ToolConfig<
  PlanetScaleDeleteBranchParams,
  PlanetScaleToolResponse<{ deleted: boolean }>
> = {
  id: 'planetscale_delete_branch',
  name: 'PlanetScale Delete Branch',
  description: 'Delete a branch',
  version: '1.0.0',
  params: {
    serviceTokenId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PlanetScale service token ID',
    },
    serviceToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PlanetScale service token secret',
    },
    organization: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'PlanetScale organization slug',
    },
    database: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the database the branch belongs to',
    },
    branch: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the branch',
    },
    deleteDescendants: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'If true, recursively delete all descendant branches along with this branch',
    },
  },
  request: {
    url: (params) =>
      planetScaleApiUrl(
        `/organizations/${safeUrlPathSegment(params.organization, 'organization')}/databases/${safeUrlPathSegment(params.database, 'database')}/branches/${safeUrlPathSegment(params.branch, 'branch')}`,
        {
          delete_descendants: optionalPlanetScaleBoolean(
            params.deleteDescendants,
            'deleteDescendants'
          ),
        }
      ),
    method: 'DELETE',
    headers: planetScaleHeaders,
  },
  transformResponse: async () => ({ success: true, output: { deleted: true } }),
  outputs: { deleted: { type: 'boolean', description: 'Whether the branch was deleted' } },
}
