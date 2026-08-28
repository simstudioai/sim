import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { AnyApiRouteContract, ContractBody } from '@/lib/api/contracts'
import {
  onePasswordCreateItemContract,
  onePasswordDeleteItemContract,
  onePasswordGetItemContract,
  onePasswordGetItemFileContract,
  onePasswordGetVaultContract,
  onePasswordListItemsContract,
  onePasswordListVaultsContract,
  onePasswordReplaceItemContract,
  onePasswordResolveSecretContract,
  onePasswordUpdateItemContract,
} from '@/lib/api/contracts/tools/onepassword'
import { OnePasswordOperationError } from '@/lib/internal/onepassword/errors'
import {
  executeOnePasswordCreateItem,
  executeOnePasswordDeleteItem,
  executeOnePasswordGetItem,
  executeOnePasswordGetItemFile,
  executeOnePasswordGetVault,
  executeOnePasswordListItems,
  executeOnePasswordListVaults,
  executeOnePasswordReplaceItem,
  executeOnePasswordResolveSecret,
  executeOnePasswordUpdateItem,
  type OnePasswordOperationContext,
} from '@/lib/internal/onepassword/operations'
import { parseInternalToolInput } from '@/lib/internal/tool-operations/parse-input'
import type {
  InternalToolOperationCall,
  InternalToolOperationHandler,
} from '@/lib/internal/tool-operations/types'

const logger = createLogger('OnePasswordToolExecution')

async function executeOperation<C extends AnyApiRouteContract>(
  contract: C,
  request: InternalToolOperationCall,
  operation: (input: ContractBody<C>, context: OnePasswordOperationContext) => Promise<unknown>,
  failureMessage: string
): Promise<Response> {
  request.signal?.throwIfAborted()
  const parsed = parseInternalToolInput(contract, request.input)
  if (!parsed.success) return parsed.response

  try {
    const result = await operation(parsed.data, { signal: request.signal })
    request.signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    request.signal?.throwIfAborted()
    if (error instanceof OnePasswordOperationError) {
      return Response.json(error.body, { status: error.status })
    }
    const message = getErrorMessage(error, 'Unknown error')
    logger.error('1Password operation failed', {
      error: message,
      requestId: request.requestId,
      toolId: request.toolId,
    })
    return Response.json({ error: `${failureMessage}: ${message}` }, { status: 500 })
  }
}

export const executeOnePasswordTool: InternalToolOperationHandler = async (request) => {
  switch (request.toolId) {
    case 'onepassword_list_vaults':
      return executeOperation(
        onePasswordListVaultsContract,
        request,
        executeOnePasswordListVaults,
        'Failed to list vaults'
      )
    case 'onepassword_get_vault':
      return executeOperation(
        onePasswordGetVaultContract,
        request,
        executeOnePasswordGetVault,
        'Failed to get vault'
      )
    case 'onepassword_list_items':
      return executeOperation(
        onePasswordListItemsContract,
        request,
        executeOnePasswordListItems,
        'Failed to list items'
      )
    case 'onepassword_get_item':
      return executeOperation(
        onePasswordGetItemContract,
        request,
        executeOnePasswordGetItem,
        'Failed to get item'
      )
    case 'onepassword_create_item':
      return executeOperation(
        onePasswordCreateItemContract,
        request,
        executeOnePasswordCreateItem,
        'Failed to create item'
      )
    case 'onepassword_update_item':
      return executeOperation(
        onePasswordUpdateItemContract,
        request,
        executeOnePasswordUpdateItem,
        'Failed to update item'
      )
    case 'onepassword_replace_item':
      return executeOperation(
        onePasswordReplaceItemContract,
        request,
        executeOnePasswordReplaceItem,
        'Failed to replace item'
      )
    case 'onepassword_delete_item':
      return executeOperation(
        onePasswordDeleteItemContract,
        request,
        executeOnePasswordDeleteItem,
        'Failed to delete item'
      )
    case 'onepassword_resolve_secret':
      return executeOperation(
        onePasswordResolveSecretContract,
        request,
        executeOnePasswordResolveSecret,
        'Failed to resolve secret'
      )
    case 'onepassword_get_item_file':
      return executeOperation(
        onePasswordGetItemFileContract,
        request,
        executeOnePasswordGetItemFile,
        'Failed to get item file'
      )
    default:
      return Response.json(
        { error: `Unsupported 1Password tool: ${request.toolId}` },
        { status: 500 }
      )
  }
}
