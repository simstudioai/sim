import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Shared output property definitions for Hex API responses.
 * Based on Hex API documentation: https://learn.hex.tech/docs/api/api-reference
 */

/**
 * Output definition for project items returned by the Hex API.
 * The status field is an object with a name property (e.g., { name: "PUBLISHED" }).
 * The type field is a ProjectTypeApiEnum (PROJECT or COMPONENT).
 */
export const HEX_PROJECT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Project UUID' },
  title: { type: 'string', description: 'Project title' },
  description: { type: 'string', description: 'Project description', optional: true },
  status: {
    type: 'object',
    description: 'Project status',
    properties: {
      name: {
        type: 'string',
        description: 'Status name (e.g., PUBLISHED, DRAFT)',
      },
    },
  },
  type: {
    type: 'string',
    description: 'Project type (PROJECT or COMPONENT)',
  },
  creator: {
    type: 'object',
    description: 'Project creator',
    optional: true,
    properties: {
      email: { type: 'string', description: 'Creator email' },
    },
  },
  owner: {
    type: 'object',
    description: 'Project owner',
    optional: true,
    properties: {
      email: { type: 'string', description: 'Owner email' },
    },
  },
  categories: {
    type: 'array',
    description: 'Project categories',
    optional: true,
    items: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Category name' },
        description: { type: 'string', description: 'Category description' },
      },
    },
  },
  lastEditedAt: { type: 'string', description: 'ISO 8601 last edited timestamp', optional: true },
  lastPublishedAt: {
    type: 'string',
    description: 'ISO 8601 last published timestamp',
    optional: true,
  },
  createdAt: { type: 'string', description: 'ISO 8601 creation timestamp' },
  archivedAt: { type: 'string', description: 'ISO 8601 archived timestamp', optional: true },
  trashedAt: { type: 'string', description: 'ISO 8601 trashed timestamp', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for run creation responses.
 * POST /v1/projects/{projectId}/runs returns projectVersion but no status.
 */
export const HEX_RUN_OUTPUT_PROPERTIES = {
  projectId: { type: 'string', description: 'Project UUID' },
  runId: { type: 'string', description: 'Run UUID' },
  runUrl: { type: 'string', description: 'URL to view the run' },
  runStatusUrl: { type: 'string', description: 'URL to check run status' },
  traceId: { type: 'string', description: 'Trace ID for debugging', optional: true },
  projectVersion: { type: 'number', description: 'Project version number', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for run status responses.
 * GET /v1/projects/{projectId}/runs/{runId} returns full run details.
 */
export const HEX_RUN_STATUS_OUTPUT_PROPERTIES = {
  projectId: { type: 'string', description: 'Project UUID' },
  runId: { type: 'string', description: 'Run UUID' },
  runUrl: { type: 'string', description: 'URL to view the run' },
  status: {
    type: 'string',
    description:
      'Run status (PENDING, RUNNING, COMPLETED, ERRORED, KILLED, UNABLE_TO_ALLOCATE_KERNEL)',
  },
  startTime: { type: 'string', description: 'ISO 8601 run start time', optional: true },
  endTime: { type: 'string', description: 'ISO 8601 run end time', optional: true },
  elapsedTime: { type: 'number', description: 'Elapsed time in seconds', optional: true },
  traceId: { type: 'string', description: 'Trace ID for debugging', optional: true },
  projectVersion: { type: 'number', description: 'Project version number', optional: true },
} as const satisfies Record<string, OutputProperty>

export interface HexListProjectsParams {
  apiKey: string
  limit?: number
  includeArchived?: boolean
  statusFilter?: string
}

export interface HexListProjectsResponse extends ToolResponse {
  output: {
    projects: Array<{
      id: string
      title: string
      description: string | null
      status: { name: string } | null
      type: string
      creator: { email: string } | null
      owner: { email: string } | null
      categories: Array<{ name: string; description: string }>
      lastEditedAt: string | null
      lastPublishedAt: string | null
      createdAt: string
      archivedAt: string | null
      trashedAt: string | null
    }>
    total: number
  }
}

export interface HexGetProjectParams {
  apiKey: string
  projectId: string
}

export interface HexGetProjectResponse extends ToolResponse {
  output: {
    id: string
    title: string
    description: string | null
    status: { name: string } | null
    type: string
    creator: { email: string } | null
    owner: { email: string } | null
    categories: Array<{ name: string; description: string }>
    lastEditedAt: string | null
    lastPublishedAt: string | null
    createdAt: string
    archivedAt: string | null
    trashedAt: string | null
  }
}

export interface HexRunProjectParams {
  apiKey: string
  projectId: string
  inputParams?: string
  dryRun?: boolean
  updateCache?: boolean
  updatePublishedResults?: boolean
  useCachedSqlResults?: boolean
}

export interface HexRunProjectResponse extends ToolResponse {
  output: {
    projectId: string
    runId: string
    runUrl: string
    runStatusUrl: string
    traceId: string | null
    projectVersion: number | null
  }
}

export interface HexGetRunStatusParams {
  apiKey: string
  projectId: string
  runId: string
}

export interface HexGetRunStatusResponse extends ToolResponse {
  output: {
    projectId: string
    runId: string
    runUrl: string | null
    status: string
    startTime: string | null
    endTime: string | null
    elapsedTime: number | null
    traceId: string | null
    projectVersion: number | null
  }
}

export interface HexCancelRunParams {
  apiKey: string
  projectId: string
  runId: string
}

export interface HexCancelRunResponse extends ToolResponse {
  output: {
    success: boolean
    projectId: string
    runId: string
  }
}

export interface HexGetProjectRunsParams {
  apiKey: string
  projectId: string
  limit?: number
  offset?: number
  statusFilter?: string
}

export interface HexGetProjectRunsResponse extends ToolResponse {
  output: {
    runs: Array<{
      projectId: string
      runId: string
      runUrl: string | null
      status: string
      startTime: string | null
      endTime: string | null
      elapsedTime: number | null
      traceId: string | null
      projectVersion: number | null
    }>
    total: number
    traceId: string | null
  }
}

export interface HexUpdateProjectParams {
  apiKey: string
  projectId: string
  status: string
}

export interface HexUpdateProjectResponse extends ToolResponse {
  output: {
    id: string
    title: string
    description: string | null
    status: { name: string } | null
    type: string
    creator: { email: string } | null
    owner: { email: string } | null
    categories: Array<{ name: string; description: string }>
    lastEditedAt: string | null
    lastPublishedAt: string | null
    createdAt: string
    archivedAt: string | null
    trashedAt: string | null
  }
}

export interface HexListUsersParams {
  apiKey: string
  limit?: number
  sortBy?: string
  sortDirection?: string
  groupId?: string
}

export interface HexListUsersResponse extends ToolResponse {
  output: {
    users: Array<{
      id: string
      name: string
      email: string
      role: string
    }>
    total: number
  }
}

export interface HexListCollectionsParams {
  apiKey: string
  limit?: number
  sortBy?: string
}

export interface HexListCollectionsResponse extends ToolResponse {
  output: {
    collections: Array<{
      id: string
      name: string
      description: string | null
      creator: { email: string; id: string } | null
    }>
    total: number
  }
}

export interface HexListDataConnectionsParams {
  apiKey: string
  limit?: number
  sortBy?: string
  sortDirection?: string
}

export interface HexListDataConnectionsResponse extends ToolResponse {
  output: {
    connections: Array<{
      id: string
      name: string
      type: string
      description: string | null
      connectViaSsh: boolean | null
      includeMagic: boolean | null
      allowWritebackCells: boolean | null
    }>
    total: number
  }
}

export interface HexGetQueriedTablesParams {
  apiKey: string
  projectId: string
  limit?: number
}

export interface HexGetQueriedTablesResponse extends ToolResponse {
  output: {
    tables: Array<{
      dataConnectionId: string | null
      dataConnectionName: string | null
      tableName: string | null
    }>
    total: number
  }
}

export interface HexListGroupsParams {
  apiKey: string
  limit?: number
  sortBy?: string
  sortDirection?: string
}

export interface HexListGroupsResponse extends ToolResponse {
  output: {
    groups: Array<{
      id: string
      name: string
      createdAt: string | null
    }>
    total: number
  }
}

export interface HexGetGroupParams {
  apiKey: string
  groupId: string
}

export interface HexGetGroupResponse extends ToolResponse {
  output: {
    id: string
    name: string
    createdAt: string | null
  }
}

export interface HexGetDataConnectionParams {
  apiKey: string
  dataConnectionId: string
}

export interface HexGetDataConnectionResponse extends ToolResponse {
  output: {
    id: string
    name: string
    type: string
    description: string | null
    connectViaSsh: boolean | null
    includeMagic: boolean | null
    allowWritebackCells: boolean | null
  }
}

export interface HexGetCollectionParams {
  apiKey: string
  collectionId: string
}

export interface HexGetCollectionResponse extends ToolResponse {
  output: {
    id: string
    name: string
    description: string | null
    creator: { email: string; id: string } | null
  }
}

export interface HexCreateCollectionParams {
  apiKey: string
  name: string
  description?: string
}

export interface HexCreateCollectionResponse extends ToolResponse {
  output: {
    id: string
    name: string
    description: string | null
    creator: { email: string; id: string } | null
  }
}

export type HexResponse =
  | HexListProjectsResponse
  | HexGetProjectResponse
  | HexRunProjectResponse
  | HexGetRunStatusResponse
  | HexCancelRunResponse
  | HexGetProjectRunsResponse
  | HexUpdateProjectResponse
  | HexListUsersResponse
  | HexListCollectionsResponse
  | HexListDataConnectionsResponse
  | HexGetQueriedTablesResponse
  | HexListGroupsResponse
  | HexGetGroupResponse
  | HexGetDataConnectionResponse
  | HexGetCollectionResponse
  | HexCreateCollectionResponse
