import {
  PLANETSCALE_BRANCH_OUTPUT_PROPERTIES,
  type PlanetScaleBranch,
  type PlanetScaleCreateBranchParams,
  type PlanetScaleToolResponse,
} from '@/tools/planetscale/types'
import {
  optionalPlanetScaleBoolean,
  optionalPlanetScaleEnum,
  optionalPlanetScaleInteger,
  optionalPlanetScaleString,
  planetScaleApiUrl,
  planetScaleBody,
  planetScaleBranchSchema,
  planetScaleHeaders,
  planetScaleJson,
} from '@/tools/planetscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'
export const planetScaleCreateBranchTool: ToolConfig<
  PlanetScaleCreateBranchParams,
  PlanetScaleToolResponse<{ branch: PlanetScaleBranch }>
> = {
  id: 'planetscale_create_branch',
  name: 'PlanetScale Create Branch',
  description: 'Create a branch',
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
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the branch to create',
    },
    deletionProtected: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether deletion protection is enabled for the branch',
    },
    parentBranch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "The name of the parent branch. Defaults to the database's default branch if not provided.",
    },
    backupId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "If provided, restores the backup's schema and data to the new branch. Must have `restore_production_branch_backup(s)` or `restore_backup(s)` access to do this.",
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The region to create the branch in. If not provided, the branch will be created in the default region for its database.',
    },
    restorePoint: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Restore from a point-in-time recovery timestamp (e.g. 2023-01-01T00:00:00Z). Available only for PostgreSQL databases.',
    },
    replicas: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        "For PostgreSQL backup restores and point-in-time recovery, the number of additional replicas from 0 to 8, subject to the target cluster size. 0 creates a single-node branch. If omitted, the target cluster size's minimum is used.",
    },
    seedData: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "If provided, restores the last successful backup's schema and data to the new branch. Must have `restore_production_branch_backup(s)` or `restore_backup(s)` access to do this, in addition to Data Branching\u2122 being enabled for the branch.",
    },
    clusterSize: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The database cluster size. Required when backupId is provided, optional otherwise. Options: PS_10, PS_20, PS_40, ..., PS_2800',
    },
    majorVersion: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "For PostgreSQL and Neki databases, the PostgreSQL major version to use for the branch. Defaults to the major version of the parent branch if it exists or the database's default branch major version. Ignored for branches restored from backups.",
    },
  },
  request: {
    url: (params) =>
      planetScaleApiUrl(
        `/organizations/${safeUrlPathSegment(params.organization, 'organization')}/databases/${safeUrlPathSegment(params.database, 'database')}/branches`,
        {}
      ),
    method: 'POST',
    headers: planetScaleHeaders,
    body: (params) => {
      const backupId = optionalPlanetScaleString(params.backupId, 'backupId')?.trim() || undefined
      const clusterSize =
        optionalPlanetScaleString(params.clusterSize, 'clusterSize')?.trim() || undefined
      if (backupId && !clusterSize)
        throw new Error('clusterSize is required when restoring a backup')
      return planetScaleBody({
        name: params.name,
        deletion_protected: optionalPlanetScaleBoolean(
          params.deletionProtected,
          'deletionProtected'
        ),
        parent_branch: optionalPlanetScaleString(params.parentBranch, 'parentBranch'),
        backup_id: backupId,
        region: optionalPlanetScaleString(params.region, 'region'),
        restore_point: optionalPlanetScaleString(params.restorePoint, 'restorePoint'),
        replicas: optionalPlanetScaleInteger(params.replicas, 'replicas', 0, 8),
        seed_data: optionalPlanetScaleEnum(params.seedData, 'seedData', ['last_successful_backup']),
        cluster_size: clusterSize,
        major_version: optionalPlanetScaleString(params.majorVersion, 'majorVersion'),
      })
    },
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
