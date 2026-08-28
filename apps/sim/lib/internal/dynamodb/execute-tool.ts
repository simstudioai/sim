import { toError } from '@sim/utils/errors'
import type { AnyApiRouteContract, ContractBody } from '@/lib/api/contracts'
import { awsDynamodbDeleteContract } from '@/lib/api/contracts/tools/aws/dynamodb-delete'
import { awsDynamodbGetContract } from '@/lib/api/contracts/tools/aws/dynamodb-get'
import { awsDynamodbIntrospectContract } from '@/lib/api/contracts/tools/aws/dynamodb-introspect'
import { awsDynamodbPutContract } from '@/lib/api/contracts/tools/aws/dynamodb-put'
import { awsDynamodbQueryContract } from '@/lib/api/contracts/tools/aws/dynamodb-query'
import { awsDynamodbScanContract } from '@/lib/api/contracts/tools/aws/dynamodb-scan'
import { awsDynamodbUpdateContract } from '@/lib/api/contracts/tools/aws/dynamodb-update'
import {
  executeDynamodbDelete,
  executeDynamodbGet,
  executeDynamodbIntrospect,
  executeDynamodbPut,
  executeDynamodbQuery,
  executeDynamodbScan,
  executeDynamodbUpdate,
} from '@/lib/internal/dynamodb/operations'
import { parseInternalToolInput } from '@/lib/internal/tool-operations/parse-input'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

interface DynamoDbErrorPolicy {
  fallback: string
  prefix?: string
}

async function executeOperation<C extends AnyApiRouteContract>(
  contract: C,
  input: unknown,
  execute: (input: ContractBody<C>, signal?: AbortSignal) => Promise<unknown>,
  errorPolicy: DynamoDbErrorPolicy,
  signal?: AbortSignal
): Promise<Response> {
  const parsed = parseInternalToolInput(contract, input)
  if (!parsed.success) return parsed.response

  try {
    const result = await execute(parsed.data, signal)
    signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    signal?.throwIfAborted()
    const message = toError(error).message || errorPolicy.fallback
    return Response.json(
      { error: errorPolicy.prefix ? `${errorPolicy.prefix}: ${message}` : message },
      { status: 500 }
    )
  }
}

export const executeDynamodbTool: InternalToolOperationHandler = async ({
  toolId,
  input,
  signal,
}) => {
  signal?.throwIfAborted()

  switch (toolId) {
    case 'dynamodb_delete':
      return executeOperation(
        awsDynamodbDeleteContract,
        input,
        executeDynamodbDelete,
        { fallback: 'DynamoDB delete failed' },
        signal
      )
    case 'dynamodb_get':
      return executeOperation(
        awsDynamodbGetContract,
        input,
        executeDynamodbGet,
        { fallback: 'DynamoDB get failed' },
        signal
      )
    case 'dynamodb_introspect':
      return executeOperation(
        awsDynamodbIntrospectContract,
        input,
        executeDynamodbIntrospect,
        { fallback: 'Unknown error occurred', prefix: 'DynamoDB introspection failed' },
        signal
      )
    case 'dynamodb_put':
      return executeOperation(
        awsDynamodbPutContract,
        input,
        executeDynamodbPut,
        { fallback: 'DynamoDB put failed' },
        signal
      )
    case 'dynamodb_query':
      return executeOperation(
        awsDynamodbQueryContract,
        input,
        executeDynamodbQuery,
        { fallback: 'DynamoDB query failed' },
        signal
      )
    case 'dynamodb_scan':
      return executeOperation(
        awsDynamodbScanContract,
        input,
        executeDynamodbScan,
        { fallback: 'DynamoDB scan failed' },
        signal
      )
    case 'dynamodb_update':
      return executeOperation(
        awsDynamodbUpdateContract,
        input,
        executeDynamodbUpdate,
        { fallback: 'DynamoDB update failed' },
        signal
      )
    default:
      return Response.json({ error: `Unsupported DynamoDB tool: ${toolId}` }, { status: 500 })
  }
}
