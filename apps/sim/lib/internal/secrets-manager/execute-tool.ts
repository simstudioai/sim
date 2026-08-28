import { getErrorMessage } from '@sim/utils/errors'
import type { AnyApiRouteContract, ContractBody } from '@/lib/api/contracts'
import { awsSecretsManagerCreateSecretContract } from '@/lib/api/contracts/tools/aws/secrets-manager-create-secret'
import { awsSecretsManagerDeleteSecretContract } from '@/lib/api/contracts/tools/aws/secrets-manager-delete-secret'
import { awsSecretsManagerDescribeSecretContract } from '@/lib/api/contracts/tools/aws/secrets-manager-describe-secret'
import { awsSecretsManagerGetSecretContract } from '@/lib/api/contracts/tools/aws/secrets-manager-get-secret'
import { awsSecretsManagerListSecretsContract } from '@/lib/api/contracts/tools/aws/secrets-manager-list-secrets'
import { awsSecretsManagerRestoreSecretContract } from '@/lib/api/contracts/tools/aws/secrets-manager-restore-secret'
import { awsSecretsManagerRotateSecretContract } from '@/lib/api/contracts/tools/aws/secrets-manager-rotate-secret'
import { awsSecretsManagerTagResourceContract } from '@/lib/api/contracts/tools/aws/secrets-manager-tag-resource'
import { awsSecretsManagerUntagResourceContract } from '@/lib/api/contracts/tools/aws/secrets-manager-untag-resource'
import { awsSecretsManagerUpdateSecretContract } from '@/lib/api/contracts/tools/aws/secrets-manager-update-secret'
import {
  executeSecretsManagerCreateSecret,
  executeSecretsManagerDeleteSecret,
  executeSecretsManagerDescribeSecret,
  executeSecretsManagerGetSecret,
  executeSecretsManagerListSecrets,
  executeSecretsManagerRestoreSecret,
  executeSecretsManagerRotateSecret,
  executeSecretsManagerTagResource,
  executeSecretsManagerUntagResource,
  executeSecretsManagerUpdateSecret,
} from '@/lib/internal/secrets-manager/operations'
import { parseInternalToolInput } from '@/lib/internal/tool-operations/parse-input'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

async function executeOperation<C extends AnyApiRouteContract>(
  contract: C,
  input: unknown,
  execute: (input: ContractBody<C>, signal?: AbortSignal) => Promise<unknown>,
  errorMessage: string,
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
    return Response.json(
      { error: `${errorMessage}: ${getErrorMessage(error, 'Unknown error occurred')}` },
      { status: 500 }
    )
  }
}

export const executeSecretsManagerTool: InternalToolOperationHandler = async ({
  toolId,
  input,
  signal,
}) => {
  signal?.throwIfAborted()

  switch (toolId) {
    case 'secrets_manager_get_secret':
      return executeOperation(
        awsSecretsManagerGetSecretContract,
        input,
        executeSecretsManagerGetSecret,
        'Failed to retrieve secret',
        signal
      )
    case 'secrets_manager_list_secrets':
      return executeOperation(
        awsSecretsManagerListSecretsContract,
        input,
        executeSecretsManagerListSecrets,
        'Failed to list secrets',
        signal
      )
    case 'secrets_manager_create_secret':
      return executeOperation(
        awsSecretsManagerCreateSecretContract,
        input,
        executeSecretsManagerCreateSecret,
        'Failed to create secret',
        signal
      )
    case 'secrets_manager_update_secret':
      return executeOperation(
        awsSecretsManagerUpdateSecretContract,
        input,
        executeSecretsManagerUpdateSecret,
        'Failed to update secret',
        signal
      )
    case 'secrets_manager_delete_secret':
      return executeOperation(
        awsSecretsManagerDeleteSecretContract,
        input,
        executeSecretsManagerDeleteSecret,
        'Failed to delete secret',
        signal
      )
    case 'secrets_manager_describe_secret':
      return executeOperation(
        awsSecretsManagerDescribeSecretContract,
        input,
        executeSecretsManagerDescribeSecret,
        'Failed to describe secret',
        signal
      )
    case 'secrets_manager_tag_resource':
      return executeOperation(
        awsSecretsManagerTagResourceContract,
        input,
        executeSecretsManagerTagResource,
        'Failed to tag secret',
        signal
      )
    case 'secrets_manager_untag_resource':
      return executeOperation(
        awsSecretsManagerUntagResourceContract,
        input,
        executeSecretsManagerUntagResource,
        'Failed to untag secret',
        signal
      )
    case 'secrets_manager_restore_secret':
      return executeOperation(
        awsSecretsManagerRestoreSecretContract,
        input,
        executeSecretsManagerRestoreSecret,
        'Failed to restore secret',
        signal
      )
    case 'secrets_manager_rotate_secret':
      return executeOperation(
        awsSecretsManagerRotateSecretContract,
        input,
        executeSecretsManagerRotateSecret,
        'Failed to rotate secret',
        signal
      )
    default:
      return Response.json(
        { error: `Unsupported Secrets Manager tool: ${toolId}` },
        { status: 500 }
      )
  }
}
