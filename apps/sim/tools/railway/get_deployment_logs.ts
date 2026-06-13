import type {
  RailwayDeploymentLog,
  RailwayGetDeploymentLogsParams,
  RailwayGetDeploymentLogsResponse,
} from '@/tools/railway/types'
import {
  parseRailwayGraphqlResponse,
  RAILWAY_GRAPHQL_URL,
  railwayHeaders,
} from '@/tools/railway/utils'
import type { ToolConfig } from '@/tools/types'

interface RailwayGetDeploymentLogsData {
  deploymentLogs?: Array<{
    timestamp: string
    message: string
    severity?: string | null
  }>
}

export const railwayGetDeploymentLogsTool: ToolConfig<
  RailwayGetDeploymentLogsParams,
  RailwayGetDeploymentLogsResponse
> = {
  id: 'railway_get_deployment_logs',
  name: 'Railway Get Deployment Logs',
  description: 'Retrieve runtime logs for a Railway deployment',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Railway API token',
    },
    tokenType: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Railway token type. Use "account" for account, workspace, or OAuth tokens, or "project" for project tokens.',
    },
    deploymentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Railway deployment ID',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of log lines to return',
    },
  },

  request: {
    url: RAILWAY_GRAPHQL_URL,
    method: 'POST',
    headers: (params) => railwayHeaders(params.apiKey, params.tokenType),
    body: (params) => ({
      query: `
        query DeploymentLogs($deploymentId: String!, $limit: Int) {
          deploymentLogs(deploymentId: $deploymentId, limit: $limit) {
            timestamp
            message
            severity
          }
        }
      `,
      variables: {
        deploymentId: params.deploymentId.trim(),
        limit: params.limit ? Number(params.limit) : undefined,
      },
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await parseRailwayGraphqlResponse<RailwayGetDeploymentLogsData>(response)
    const logEntries = data.data?.deploymentLogs
    if (!logEntries) throw new Error('Railway did not return deployment logs')

    const logs: RailwayDeploymentLog[] = logEntries.map((log) => ({
      timestamp: log.timestamp,
      message: log.message,
      severity: log.severity ?? null,
    }))

    return {
      success: true,
      output: {
        logs,
        count: logs.length,
      },
    }
  },

  outputs: {
    logs: {
      type: 'array',
      description: 'Deployment log entries',
      items: {
        type: 'object',
        properties: {
          timestamp: { type: 'string', description: 'Log timestamp' },
          message: { type: 'string', description: 'Log message' },
          severity: { type: 'string', description: 'Log severity', optional: true },
        },
      },
    },
    count: {
      type: 'number',
      description: 'Number of log entries returned',
    },
  },
}
