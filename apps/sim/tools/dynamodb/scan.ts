import type { DynamoDBScanParams, DynamoDBScanResponse } from '@/tools/dynamodb/types'
import { AWS_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { InternalToolConfig } from '@/tools/types'

export const scanTool: InternalToolConfig<DynamoDBScanParams, DynamoDBScanResponse> = {
  id: 'dynamodb_scan',
  name: 'DynamoDB Scan',
  description: 'Scan all items in a DynamoDB table',
  version: '1.0.0',
  oauth: AWS_CREDENTIAL_OAUTH,

  params: {
    region: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS region (e.g., us-east-1)',
    },
    accessKeyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS access key ID',
    },
    secretAccessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS secret access key',
    },
    tableName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'DynamoDB table name (e.g., "Users", "Orders")',
    },
    filterExpression: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter expression for results (e.g., "age > :minAge AND #status = :status")',
    },
    projectionExpression: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Attributes to retrieve (e.g., "pk, sk, #name, email")',
    },
    expressionAttributeNames: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Attribute name mappings for reserved words (e.g., {"#name": "name", "#status": "status"})',
    },
    expressionAttributeValues: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Expression attribute values (e.g., {":minAge": 18, ":status": "active"})',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of items to return (e.g., 10, 50, 100)',
    },
    exclusiveStartKey: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Pagination token from a previous scan's lastEvaluatedKey to continue fetching results",
    },
    indexName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Secondary index to scan instead of the table (e.g., "GSI1")',
    },
    consistentRead: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Use a strongly consistent read (default: false). Not supported on global secondary indexes',
    },
    segment: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Segment to scan in a parallel scan (0 to totalSegments - 1). Requires totalSegments',
    },
    totalSegments: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Total number of segments in a parallel scan (1-1000000). Requires segment',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      tableName: params.tableName,
      ...(params.filterExpression && { filterExpression: params.filterExpression }),
      ...(params.projectionExpression && { projectionExpression: params.projectionExpression }),
      ...(params.expressionAttributeNames && {
        expressionAttributeNames: params.expressionAttributeNames,
      }),
      ...(params.expressionAttributeValues && {
        expressionAttributeValues: params.expressionAttributeValues,
      }),
      ...(params.limit && { limit: params.limit }),
      ...(params.exclusiveStartKey && { exclusiveStartKey: params.exclusiveStartKey }),
      ...(params.indexName && { indexName: params.indexName }),
      ...(params.consistentRead !== undefined && { consistentRead: params.consistentRead }),
      ...(params.segment !== undefined && { segment: params.segment }),
      ...(params.totalSegments !== undefined && { totalSegments: params.totalSegments }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'DynamoDB scan failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Scan executed successfully',
        items: data.items || [],
        count: data.count || 0,
        scannedCount: data.scannedCount ?? null,
        ...(data.lastEvaluatedKey && { lastEvaluatedKey: data.lastEvaluatedKey }),
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    items: { type: 'array', description: 'Array of items returned' },
    count: { type: 'number', description: 'Number of items returned' },
    scannedCount: {
      type: 'number',
      description: 'Number of items evaluated before the filter expression was applied',
      optional: true,
    },
    lastEvaluatedKey: {
      type: 'json',
      description:
        'Pagination token to pass as exclusiveStartKey to fetch the next page of results',
      optional: true,
    },
  },
}
