import { getErrorMessage } from '@sim/utils/errors'
import type { AnyApiRouteContract, ContractBody } from '@/lib/api/contracts'
import { awsLambdaAddPermissionContract } from '@/lib/api/contracts/tools/aws/lambda-add-permission'
import { awsLambdaCreateAliasContract } from '@/lib/api/contracts/tools/aws/lambda-create-alias'
import { awsLambdaCreateEventSourceMappingContract } from '@/lib/api/contracts/tools/aws/lambda-create-event-source-mapping'
import { awsLambdaCreateFunctionContract } from '@/lib/api/contracts/tools/aws/lambda-create-function'
import { awsLambdaCreateFunctionUrlConfigContract } from '@/lib/api/contracts/tools/aws/lambda-create-function-url-config'
import { awsLambdaDeleteAliasContract } from '@/lib/api/contracts/tools/aws/lambda-delete-alias'
import { awsLambdaDeleteEventSourceMappingContract } from '@/lib/api/contracts/tools/aws/lambda-delete-event-source-mapping'
import { awsLambdaDeleteFunctionContract } from '@/lib/api/contracts/tools/aws/lambda-delete-function'
import { awsLambdaDeleteFunctionConcurrencyContract } from '@/lib/api/contracts/tools/aws/lambda-delete-function-concurrency'
import { awsLambdaDeleteFunctionEventInvokeConfigContract } from '@/lib/api/contracts/tools/aws/lambda-delete-function-event-invoke-config'
import { awsLambdaDeleteFunctionUrlConfigContract } from '@/lib/api/contracts/tools/aws/lambda-delete-function-url-config'
import { awsLambdaDeleteProvisionedConcurrencyConfigContract } from '@/lib/api/contracts/tools/aws/lambda-delete-provisioned-concurrency-config'
import { awsLambdaGetAccountSettingsContract } from '@/lib/api/contracts/tools/aws/lambda-get-account-settings'
import { awsLambdaGetAliasContract } from '@/lib/api/contracts/tools/aws/lambda-get-alias'
import { awsLambdaGetEventSourceMappingContract } from '@/lib/api/contracts/tools/aws/lambda-get-event-source-mapping'
import { awsLambdaGetFunctionContract } from '@/lib/api/contracts/tools/aws/lambda-get-function'
import { awsLambdaGetFunctionConcurrencyContract } from '@/lib/api/contracts/tools/aws/lambda-get-function-concurrency'
import { awsLambdaGetFunctionConfigurationContract } from '@/lib/api/contracts/tools/aws/lambda-get-function-configuration'
import { awsLambdaGetFunctionEventInvokeConfigContract } from '@/lib/api/contracts/tools/aws/lambda-get-function-event-invoke-config'
import { awsLambdaGetFunctionRecursionConfigContract } from '@/lib/api/contracts/tools/aws/lambda-get-function-recursion-config'
import { awsLambdaGetFunctionUrlConfigContract } from '@/lib/api/contracts/tools/aws/lambda-get-function-url-config'
import { awsLambdaGetLayerVersionContract } from '@/lib/api/contracts/tools/aws/lambda-get-layer-version'
import { awsLambdaGetPolicyContract } from '@/lib/api/contracts/tools/aws/lambda-get-policy'
import { awsLambdaGetProvisionedConcurrencyConfigContract } from '@/lib/api/contracts/tools/aws/lambda-get-provisioned-concurrency-config'
import { awsLambdaGetRuntimeManagementConfigContract } from '@/lib/api/contracts/tools/aws/lambda-get-runtime-management-config'
import { awsLambdaInvokeContract } from '@/lib/api/contracts/tools/aws/lambda-invoke'
import { awsLambdaListAliasesContract } from '@/lib/api/contracts/tools/aws/lambda-list-aliases'
import { awsLambdaListEventSourceMappingsContract } from '@/lib/api/contracts/tools/aws/lambda-list-event-source-mappings'
import { awsLambdaListFunctionEventInvokeConfigsContract } from '@/lib/api/contracts/tools/aws/lambda-list-function-event-invoke-configs'
import { awsLambdaListFunctionUrlConfigsContract } from '@/lib/api/contracts/tools/aws/lambda-list-function-url-configs'
import { awsLambdaListFunctionsContract } from '@/lib/api/contracts/tools/aws/lambda-list-functions'
import { awsLambdaListLayerVersionsContract } from '@/lib/api/contracts/tools/aws/lambda-list-layer-versions'
import { awsLambdaListLayersContract } from '@/lib/api/contracts/tools/aws/lambda-list-layers'
import { awsLambdaListProvisionedConcurrencyConfigsContract } from '@/lib/api/contracts/tools/aws/lambda-list-provisioned-concurrency-configs'
import { awsLambdaListTagsContract } from '@/lib/api/contracts/tools/aws/lambda-list-tags'
import { awsLambdaListVersionsByFunctionContract } from '@/lib/api/contracts/tools/aws/lambda-list-versions-by-function'
import { awsLambdaPublishVersionContract } from '@/lib/api/contracts/tools/aws/lambda-publish-version'
import { awsLambdaPutFunctionConcurrencyContract } from '@/lib/api/contracts/tools/aws/lambda-put-function-concurrency'
import { awsLambdaPutFunctionEventInvokeConfigContract } from '@/lib/api/contracts/tools/aws/lambda-put-function-event-invoke-config'
import { awsLambdaPutFunctionRecursionConfigContract } from '@/lib/api/contracts/tools/aws/lambda-put-function-recursion-config'
import { awsLambdaPutProvisionedConcurrencyConfigContract } from '@/lib/api/contracts/tools/aws/lambda-put-provisioned-concurrency-config'
import { awsLambdaPutRuntimeManagementConfigContract } from '@/lib/api/contracts/tools/aws/lambda-put-runtime-management-config'
import { awsLambdaRemovePermissionContract } from '@/lib/api/contracts/tools/aws/lambda-remove-permission'
import { awsLambdaTagResourceContract } from '@/lib/api/contracts/tools/aws/lambda-tag-resource'
import { awsLambdaUntagResourceContract } from '@/lib/api/contracts/tools/aws/lambda-untag-resource'
import { awsLambdaUpdateAliasContract } from '@/lib/api/contracts/tools/aws/lambda-update-alias'
import { awsLambdaUpdateEventSourceMappingContract } from '@/lib/api/contracts/tools/aws/lambda-update-event-source-mapping'
import { awsLambdaUpdateFunctionCodeContract } from '@/lib/api/contracts/tools/aws/lambda-update-function-code'
import { awsLambdaUpdateFunctionConfigurationContract } from '@/lib/api/contracts/tools/aws/lambda-update-function-configuration'
import { awsLambdaUpdateFunctionUrlConfigContract } from '@/lib/api/contracts/tools/aws/lambda-update-function-url-config'
import {
  executeLambdaAddPermission,
  executeLambdaCreateAlias,
  executeLambdaCreateEventSourceMapping,
  executeLambdaCreateFunction,
  executeLambdaCreateFunctionUrlConfig,
  executeLambdaDeleteAlias,
  executeLambdaDeleteEventSourceMapping,
  executeLambdaDeleteFunction,
  executeLambdaDeleteFunctionConcurrency,
  executeLambdaDeleteFunctionEventInvokeConfig,
  executeLambdaDeleteFunctionUrlConfig,
  executeLambdaDeleteProvisionedConcurrencyConfig,
  executeLambdaGetAccountSettings,
  executeLambdaGetAlias,
  executeLambdaGetEventSourceMapping,
  executeLambdaGetFunction,
  executeLambdaGetFunctionConcurrency,
  executeLambdaGetFunctionConfiguration,
  executeLambdaGetFunctionEventInvokeConfig,
  executeLambdaGetFunctionRecursionConfig,
  executeLambdaGetFunctionUrlConfig,
  executeLambdaGetLayerVersion,
  executeLambdaGetPolicy,
  executeLambdaGetProvisionedConcurrencyConfig,
  executeLambdaGetRuntimeManagementConfig,
  executeLambdaInvoke,
  executeLambdaListAliases,
  executeLambdaListEventSourceMappings,
  executeLambdaListFunctionEventInvokeConfigs,
  executeLambdaListFunctions,
  executeLambdaListFunctionUrlConfigs,
  executeLambdaListLayers,
  executeLambdaListLayerVersions,
  executeLambdaListProvisionedConcurrencyConfigs,
  executeLambdaListTags,
  executeLambdaListVersionsByFunction,
  executeLambdaPublishVersion,
  executeLambdaPutFunctionConcurrency,
  executeLambdaPutFunctionEventInvokeConfig,
  executeLambdaPutFunctionRecursionConfig,
  executeLambdaPutProvisionedConcurrencyConfig,
  executeLambdaPutRuntimeManagementConfig,
  executeLambdaRemovePermission,
  executeLambdaTagResource,
  executeLambdaUntagResource,
  executeLambdaUpdateAlias,
  executeLambdaUpdateEventSourceMapping,
  executeLambdaUpdateFunctionCode,
  executeLambdaUpdateFunctionConfiguration,
  executeLambdaUpdateFunctionUrlConfig,
} from '@/lib/internal/lambda/operations'
import { parseInternalToolInput } from '@/lib/internal/tool-operations/parse-input'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

async function executeOperation<C extends AnyApiRouteContract>(
  contract: C,
  input: unknown,
  execute: (input: ContractBody<C>, signal?: AbortSignal) => Promise<unknown>,
  fallbackError: string,
  signal?: AbortSignal
): Promise<Response> {
  signal?.throwIfAborted()
  const parsed = parseInternalToolInput(contract, input)
  if (!parsed.success) return parsed.response

  try {
    const result = await execute(parsed.data, signal)
    signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    signal?.throwIfAborted()
    return Response.json({ error: getErrorMessage(error, fallbackError) }, { status: 500 })
  }
}

export const executeLambdaTool: InternalToolOperationHandler = async ({
  toolId,
  input,
  signal,
}) => {
  signal?.throwIfAborted()
  switch (toolId) {
    case 'lambda_add_permission':
      return executeOperation(
        awsLambdaAddPermissionContract,
        input,
        executeLambdaAddPermission,
        'Failed to add Lambda permission',
        signal
      )
    case 'lambda_create_alias':
      return executeOperation(
        awsLambdaCreateAliasContract,
        input,
        executeLambdaCreateAlias,
        'Failed to create Lambda alias',
        signal
      )
    case 'lambda_create_event_source_mapping':
      return executeOperation(
        awsLambdaCreateEventSourceMappingContract,
        input,
        executeLambdaCreateEventSourceMapping,
        'Failed to create Lambda event source mapping',
        signal
      )
    case 'lambda_create_function':
      return executeOperation(
        awsLambdaCreateFunctionContract,
        input,
        executeLambdaCreateFunction,
        'Failed to create Lambda function',
        signal
      )
    case 'lambda_create_function_url_config':
      return executeOperation(
        awsLambdaCreateFunctionUrlConfigContract,
        input,
        executeLambdaCreateFunctionUrlConfig,
        'Failed to create Lambda function URL configuration',
        signal
      )
    case 'lambda_delete_alias':
      return executeOperation(
        awsLambdaDeleteAliasContract,
        input,
        executeLambdaDeleteAlias,
        'Failed to delete Lambda alias',
        signal
      )
    case 'lambda_delete_event_source_mapping':
      return executeOperation(
        awsLambdaDeleteEventSourceMappingContract,
        input,
        executeLambdaDeleteEventSourceMapping,
        'Failed to delete Lambda event source mapping',
        signal
      )
    case 'lambda_delete_function':
      return executeOperation(
        awsLambdaDeleteFunctionContract,
        input,
        executeLambdaDeleteFunction,
        'Failed to delete Lambda function',
        signal
      )
    case 'lambda_delete_function_concurrency':
      return executeOperation(
        awsLambdaDeleteFunctionConcurrencyContract,
        input,
        executeLambdaDeleteFunctionConcurrency,
        'Failed to delete Lambda function concurrency',
        signal
      )
    case 'lambda_delete_function_event_invoke_config':
      return executeOperation(
        awsLambdaDeleteFunctionEventInvokeConfigContract,
        input,
        executeLambdaDeleteFunctionEventInvokeConfig,
        'Failed to delete Lambda asynchronous invocation configuration',
        signal
      )
    case 'lambda_delete_function_url_config':
      return executeOperation(
        awsLambdaDeleteFunctionUrlConfigContract,
        input,
        executeLambdaDeleteFunctionUrlConfig,
        'Failed to delete Lambda function URL configuration',
        signal
      )
    case 'lambda_delete_provisioned_concurrency_config':
      return executeOperation(
        awsLambdaDeleteProvisionedConcurrencyConfigContract,
        input,
        executeLambdaDeleteProvisionedConcurrencyConfig,
        'Failed to delete Lambda provisioned concurrency configuration',
        signal
      )
    case 'lambda_get_account_settings':
      return executeOperation(
        awsLambdaGetAccountSettingsContract,
        input,
        executeLambdaGetAccountSettings,
        'Failed to get Lambda account settings',
        signal
      )
    case 'lambda_get_alias':
      return executeOperation(
        awsLambdaGetAliasContract,
        input,
        executeLambdaGetAlias,
        'Failed to get Lambda alias',
        signal
      )
    case 'lambda_get_event_source_mapping':
      return executeOperation(
        awsLambdaGetEventSourceMappingContract,
        input,
        executeLambdaGetEventSourceMapping,
        'Failed to get Lambda event source mapping',
        signal
      )
    case 'lambda_get_function':
      return executeOperation(
        awsLambdaGetFunctionContract,
        input,
        executeLambdaGetFunction,
        'Failed to get Lambda function',
        signal
      )
    case 'lambda_get_function_concurrency':
      return executeOperation(
        awsLambdaGetFunctionConcurrencyContract,
        input,
        executeLambdaGetFunctionConcurrency,
        'Failed to get Lambda function concurrency',
        signal
      )
    case 'lambda_get_function_configuration':
      return executeOperation(
        awsLambdaGetFunctionConfigurationContract,
        input,
        executeLambdaGetFunctionConfiguration,
        'Failed to get Lambda function configuration',
        signal
      )
    case 'lambda_get_function_event_invoke_config':
      return executeOperation(
        awsLambdaGetFunctionEventInvokeConfigContract,
        input,
        executeLambdaGetFunctionEventInvokeConfig,
        'Failed to get Lambda asynchronous invocation configuration',
        signal
      )
    case 'lambda_get_function_recursion_config':
      return executeOperation(
        awsLambdaGetFunctionRecursionConfigContract,
        input,
        executeLambdaGetFunctionRecursionConfig,
        'Failed to get Lambda function recursion configuration',
        signal
      )
    case 'lambda_get_function_url_config':
      return executeOperation(
        awsLambdaGetFunctionUrlConfigContract,
        input,
        executeLambdaGetFunctionUrlConfig,
        'Failed to get Lambda function URL configuration',
        signal
      )
    case 'lambda_get_layer_version':
      return executeOperation(
        awsLambdaGetLayerVersionContract,
        input,
        executeLambdaGetLayerVersion,
        'Failed to get Lambda layer version',
        signal
      )
    case 'lambda_get_policy':
      return executeOperation(
        awsLambdaGetPolicyContract,
        input,
        executeLambdaGetPolicy,
        'Failed to get Lambda function policy',
        signal
      )
    case 'lambda_get_provisioned_concurrency_config':
      return executeOperation(
        awsLambdaGetProvisionedConcurrencyConfigContract,
        input,
        executeLambdaGetProvisionedConcurrencyConfig,
        'Failed to get Lambda provisioned concurrency configuration',
        signal
      )
    case 'lambda_get_runtime_management_config':
      return executeOperation(
        awsLambdaGetRuntimeManagementConfigContract,
        input,
        executeLambdaGetRuntimeManagementConfig,
        'Failed to get Lambda runtime management configuration',
        signal
      )
    case 'lambda_invoke':
      return executeOperation(
        awsLambdaInvokeContract,
        input,
        executeLambdaInvoke,
        'Failed to invoke Lambda function',
        signal
      )
    case 'lambda_list_aliases':
      return executeOperation(
        awsLambdaListAliasesContract,
        input,
        executeLambdaListAliases,
        'Failed to list Lambda aliases',
        signal
      )
    case 'lambda_list_event_source_mappings':
      return executeOperation(
        awsLambdaListEventSourceMappingsContract,
        input,
        executeLambdaListEventSourceMappings,
        'Failed to list Lambda event source mappings',
        signal
      )
    case 'lambda_list_function_event_invoke_configs':
      return executeOperation(
        awsLambdaListFunctionEventInvokeConfigsContract,
        input,
        executeLambdaListFunctionEventInvokeConfigs,
        'Failed to list Lambda asynchronous invocation configurations',
        signal
      )
    case 'lambda_list_function_url_configs':
      return executeOperation(
        awsLambdaListFunctionUrlConfigsContract,
        input,
        executeLambdaListFunctionUrlConfigs,
        'Failed to list Lambda function URL configurations',
        signal
      )
    case 'lambda_list_functions':
      return executeOperation(
        awsLambdaListFunctionsContract,
        input,
        executeLambdaListFunctions,
        'Failed to list Lambda functions',
        signal
      )
    case 'lambda_list_layer_versions':
      return executeOperation(
        awsLambdaListLayerVersionsContract,
        input,
        executeLambdaListLayerVersions,
        'Failed to list Lambda layer versions',
        signal
      )
    case 'lambda_list_layers':
      return executeOperation(
        awsLambdaListLayersContract,
        input,
        executeLambdaListLayers,
        'Failed to list Lambda layers',
        signal
      )
    case 'lambda_list_provisioned_concurrency_configs':
      return executeOperation(
        awsLambdaListProvisionedConcurrencyConfigsContract,
        input,
        executeLambdaListProvisionedConcurrencyConfigs,
        'Failed to list Lambda provisioned concurrency configurations',
        signal
      )
    case 'lambda_list_tags':
      return executeOperation(
        awsLambdaListTagsContract,
        input,
        executeLambdaListTags,
        'Failed to list Lambda tags',
        signal
      )
    case 'lambda_list_versions_by_function':
      return executeOperation(
        awsLambdaListVersionsByFunctionContract,
        input,
        executeLambdaListVersionsByFunction,
        'Failed to list Lambda function versions',
        signal
      )
    case 'lambda_publish_version':
      return executeOperation(
        awsLambdaPublishVersionContract,
        input,
        executeLambdaPublishVersion,
        'Failed to publish Lambda function version',
        signal
      )
    case 'lambda_put_function_concurrency':
      return executeOperation(
        awsLambdaPutFunctionConcurrencyContract,
        input,
        executeLambdaPutFunctionConcurrency,
        'Failed to set Lambda function concurrency',
        signal
      )
    case 'lambda_put_function_event_invoke_config':
      return executeOperation(
        awsLambdaPutFunctionEventInvokeConfigContract,
        input,
        executeLambdaPutFunctionEventInvokeConfig,
        'Failed to set Lambda asynchronous invocation configuration',
        signal
      )
    case 'lambda_put_function_recursion_config':
      return executeOperation(
        awsLambdaPutFunctionRecursionConfigContract,
        input,
        executeLambdaPutFunctionRecursionConfig,
        'Failed to set Lambda function recursion configuration',
        signal
      )
    case 'lambda_put_provisioned_concurrency_config':
      return executeOperation(
        awsLambdaPutProvisionedConcurrencyConfigContract,
        input,
        executeLambdaPutProvisionedConcurrencyConfig,
        'Failed to set Lambda provisioned concurrency configuration',
        signal
      )
    case 'lambda_put_runtime_management_config':
      return executeOperation(
        awsLambdaPutRuntimeManagementConfigContract,
        input,
        executeLambdaPutRuntimeManagementConfig,
        'Failed to set Lambda runtime management configuration',
        signal
      )
    case 'lambda_remove_permission':
      return executeOperation(
        awsLambdaRemovePermissionContract,
        input,
        executeLambdaRemovePermission,
        'Failed to remove Lambda permission',
        signal
      )
    case 'lambda_tag_resource':
      return executeOperation(
        awsLambdaTagResourceContract,
        input,
        executeLambdaTagResource,
        'Failed to tag Lambda resource',
        signal
      )
    case 'lambda_untag_resource':
      return executeOperation(
        awsLambdaUntagResourceContract,
        input,
        executeLambdaUntagResource,
        'Failed to untag Lambda resource',
        signal
      )
    case 'lambda_update_alias':
      return executeOperation(
        awsLambdaUpdateAliasContract,
        input,
        executeLambdaUpdateAlias,
        'Failed to update Lambda alias',
        signal
      )
    case 'lambda_update_event_source_mapping':
      return executeOperation(
        awsLambdaUpdateEventSourceMappingContract,
        input,
        executeLambdaUpdateEventSourceMapping,
        'Failed to update Lambda event source mapping',
        signal
      )
    case 'lambda_update_function_code':
      return executeOperation(
        awsLambdaUpdateFunctionCodeContract,
        input,
        executeLambdaUpdateFunctionCode,
        'Failed to update Lambda function code',
        signal
      )
    case 'lambda_update_function_configuration':
      return executeOperation(
        awsLambdaUpdateFunctionConfigurationContract,
        input,
        executeLambdaUpdateFunctionConfiguration,
        'Failed to update Lambda function configuration',
        signal
      )
    case 'lambda_update_function_url_config':
      return executeOperation(
        awsLambdaUpdateFunctionUrlConfigContract,
        input,
        executeLambdaUpdateFunctionUrlConfig,
        'Failed to update Lambda function URL configuration',
        signal
      )
    default:
      return Response.json({ error: `Unsupported Lambda tool: ${toolId}` }, { status: 500 })
  }
}
