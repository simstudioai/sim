import { getErrorMessage } from '@sim/utils/errors'
import type { AnyApiRouteContract, ContractBody } from '@/lib/api/contracts'
import {
  neo4jCreateContract,
  neo4jDeleteContract,
  neo4jExecuteContract,
  neo4jIntrospectContract,
  neo4jMergeContract,
  neo4jQueryContract,
  neo4jUpdateContract,
} from '@/lib/api/contracts/tools/databases/neo4j'
import {
  executeNeo4jCreate,
  executeNeo4jDelete,
  executeNeo4jIntrospection,
  executeNeo4jMerge,
  executeNeo4jQuery,
  executeNeo4jStatement,
  executeNeo4jUpdate,
  Neo4jOperationInputError,
} from '@/lib/internal/neo4j/operations'
import { parseInternalToolInput } from '@/lib/internal/tool-operations/parse-input'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

async function executeOperation<C extends AnyApiRouteContract>(
  contract: C,
  input: unknown,
  execute: (input: ContractBody<C>, signal?: AbortSignal) => Promise<unknown>,
  errorPrefix: string,
  signal?: AbortSignal
): Promise<Response> {
  const parsed = parseInternalToolInput(contract, input)
  if (!parsed.success) return parsed.response
  try {
    return Response.json(await execute(parsed.data, signal))
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof Neo4jOperationInputError) {
      return Response.json({ error: `Query validation failed: ${error.message}` }, { status: 400 })
    }
    return Response.json(
      { error: `${errorPrefix}: ${getErrorMessage(error, 'Unknown error occurred')}` },
      { status: 500 }
    )
  }
}

export const executeNeo4jTool: InternalToolOperationHandler = async ({ toolId, input, signal }) => {
  signal?.throwIfAborted()
  switch (toolId) {
    case 'neo4j_query':
      return executeOperation(
        neo4jQueryContract,
        input,
        executeNeo4jQuery,
        'Neo4j query failed',
        signal
      )
    case 'neo4j_execute':
      return executeOperation(
        neo4jExecuteContract,
        input,
        executeNeo4jStatement,
        'Neo4j execute failed',
        signal
      )
    case 'neo4j_create':
      return executeOperation(
        neo4jCreateContract,
        input,
        executeNeo4jCreate,
        'Neo4j create failed',
        signal
      )
    case 'neo4j_update':
      return executeOperation(
        neo4jUpdateContract,
        input,
        executeNeo4jUpdate,
        'Neo4j update failed',
        signal
      )
    case 'neo4j_merge':
      return executeOperation(
        neo4jMergeContract,
        input,
        executeNeo4jMerge,
        'Neo4j merge failed',
        signal
      )
    case 'neo4j_delete':
      return executeOperation(
        neo4jDeleteContract,
        input,
        executeNeo4jDelete,
        'Neo4j delete failed',
        signal
      )
    case 'neo4j_introspect':
      return executeOperation(
        neo4jIntrospectContract,
        input,
        executeNeo4jIntrospection,
        'Neo4j introspection failed',
        signal
      )
    default:
      return Response.json({ error: `Unsupported Neo4j tool: ${toolId}` }, { status: 500 })
  }
}
