import type { AthenaStartQueryParams, AthenaStartQueryResponse } from '@/tools/athena/types'
import type { InternalToolConfig } from '@/tools/types'

/**
 * Normalizes execution parameters supplied as a JSON array, a JSON-array string, or a
 * comma-separated string into the string list Athena expects.
 */
function parseExecutionParameters(value: string[] | string | undefined): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (Array.isArray(value)) {
    const values = value.map((item) => String(item))
    return values.length > 0 ? values : undefined
  }
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  if (trimmed.startsWith('[')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw new Error('Execution parameters must be a valid JSON array of strings')
    }
    if (!Array.isArray(parsed)) {
      throw new Error('Execution parameters must be a JSON array of strings')
    }
    return parsed.map((item) => String(item))
  }
  return trimmed
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export const startQueryTool: InternalToolConfig<AthenaStartQueryParams, AthenaStartQueryResponse> =
  {
    id: 'athena_start_query',
    name: 'Athena Start Query',
    description: 'Start an SQL query execution in AWS Athena',
    version: '1.0.0',

    params: {
      awsRegion: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'AWS region (e.g., us-east-1)',
      },
      awsAccessKeyId: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'AWS access key ID',
      },
      awsSecretAccessKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'AWS secret access key',
      },
      queryString: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'SQL query string to execute',
      },
      database: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Database name within the catalog',
      },
      catalog: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Data catalog name (default: AwsDataCatalog)',
      },
      outputLocation: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'S3 output location for query results (e.g., s3://bucket/path/)',
      },
      workGroup: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Workgroup to execute the query in (default: primary)',
      },
      executionParameters: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Values for ? placeholders in a parameterized query or EXECUTE statement, applied in order. Pass a JSON array of strings (e.g. ["2024-01-01", "US"]); a plain comma-separated list is also accepted when no value contains a comma',
      },
      resultReuseEnabled: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Reuse a previous result of the same query instead of re-scanning data (default: false)',
      },
      resultReuseMaxAgeInMinutes: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Maximum age in minutes of a previous result eligible for reuse (0-10080, default: 60)',
      },
    },

    operation: {
      input: (params) => {
        const executionParameters = parseExecutionParameters(params.executionParameters)
        return {
          region: params.awsRegion,
          accessKeyId: params.awsAccessKeyId,
          secretAccessKey: params.awsSecretAccessKey,
          queryString: params.queryString,
          ...(params.database && { database: params.database }),
          ...(params.catalog && { catalog: params.catalog }),
          ...(params.outputLocation && { outputLocation: params.outputLocation }),
          ...(params.workGroup && { workGroup: params.workGroup }),
          ...(executionParameters && { executionParameters }),
          ...(params.resultReuseEnabled !== undefined && {
            resultReuseEnabled: params.resultReuseEnabled,
          }),
          ...(params.resultReuseMaxAgeInMinutes !== undefined && {
            resultReuseMaxAgeInMinutes: params.resultReuseMaxAgeInMinutes,
          }),
        }
      },
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to start Athena query')
      }
      return {
        success: true,
        output: {
          queryExecutionId: data.output.queryExecutionId,
        },
      }
    },

    outputs: {
      queryExecutionId: {
        type: 'string',
        description: 'Unique ID of the started query execution',
      },
    },
  }
