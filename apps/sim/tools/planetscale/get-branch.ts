import {
  PLANETSCALE_BRANCH_OUTPUT_PROPERTIES,
  type PlanetScaleBranch,
  type PlanetScaleGetBranchParams,
  type PlanetScaleToolResponse,
} from '@/tools/planetscale/types'
import {
  PLANETSCALE_READ_RETRY,
  planetScaleApiUrl,
  planetScaleBranchSchema,
  planetScaleHeaders,
  planetScaleJson,
} from '@/tools/planetscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'
export const planetScaleGetBranchTool: ToolConfig<
  PlanetScaleGetBranchParams,
  PlanetScaleToolResponse<{ branch: PlanetScaleBranch }>
> = {
  id: 'planetscale_get_branch',
  name: 'PlanetScale Get Branch',
  description: 'Get a branch',
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
      description: 'Database name slug from `list_databases`. Example: `app-db`.',
    },
    branch: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Branch name from `list_branches`. Example: `main`.',
    },
  },
  request: {
    url: (params) =>
      planetScaleApiUrl(
        `/organizations/${safeUrlPathSegment(params.organization, 'organization')}/databases/${safeUrlPathSegment(params.database, 'database')}/branches/${safeUrlPathSegment(params.branch, 'branch')}`,
        {}
      ),
    method: 'GET',
    headers: planetScaleHeaders,
    retry: PLANETSCALE_READ_RETRY,
  },
  transformResponse: async (response) => ({
    success: true,
    output: { branch: planetScaleBranchSchema.parse(await planetScaleJson(response)) },
  }),
  outputs: {
    branch: {
      type: 'json',
      description: 'Branch details',
      properties: PLANETSCALE_BRANCH_OUTPUT_PROPERTIES,
    },
  },
}
