import type {
  AwsLambdaAddPermissionRequest,
  AwsLambdaAddPermissionResponse,
} from '@/lib/api/contracts/tools/aws/lambda-add-permission'
import type {
  AwsLambdaCreateAliasRequest,
  AwsLambdaCreateAliasResponse,
} from '@/lib/api/contracts/tools/aws/lambda-create-alias'
import type {
  AwsLambdaCreateEventSourceMappingRequest,
  AwsLambdaCreateEventSourceMappingResponse,
} from '@/lib/api/contracts/tools/aws/lambda-create-event-source-mapping'
import type {
  AwsLambdaCreateFunctionRequest,
  AwsLambdaCreateFunctionResponse,
} from '@/lib/api/contracts/tools/aws/lambda-create-function'
import type {
  AwsLambdaCreateFunctionUrlConfigRequest,
  AwsLambdaCreateFunctionUrlConfigResponse,
} from '@/lib/api/contracts/tools/aws/lambda-create-function-url-config'
import type {
  AwsLambdaDeleteAliasRequest,
  AwsLambdaDeleteAliasResponse,
} from '@/lib/api/contracts/tools/aws/lambda-delete-alias'
import type {
  AwsLambdaDeleteEventSourceMappingRequest,
  AwsLambdaDeleteEventSourceMappingResponse,
} from '@/lib/api/contracts/tools/aws/lambda-delete-event-source-mapping'
import type {
  AwsLambdaDeleteFunctionRequest,
  AwsLambdaDeleteFunctionResponse,
} from '@/lib/api/contracts/tools/aws/lambda-delete-function'
import type {
  AwsLambdaDeleteFunctionConcurrencyRequest,
  AwsLambdaDeleteFunctionConcurrencyResponse,
} from '@/lib/api/contracts/tools/aws/lambda-delete-function-concurrency'
import type {
  AwsLambdaDeleteFunctionEventInvokeConfigRequest,
  AwsLambdaDeleteFunctionEventInvokeConfigResponse,
} from '@/lib/api/contracts/tools/aws/lambda-delete-function-event-invoke-config'
import type {
  AwsLambdaDeleteFunctionUrlConfigRequest,
  AwsLambdaDeleteFunctionUrlConfigResponse,
} from '@/lib/api/contracts/tools/aws/lambda-delete-function-url-config'
import type {
  AwsLambdaDeleteProvisionedConcurrencyConfigRequest,
  AwsLambdaDeleteProvisionedConcurrencyConfigResponse,
} from '@/lib/api/contracts/tools/aws/lambda-delete-provisioned-concurrency-config'
import type {
  AwsLambdaGetAccountSettingsRequest,
  AwsLambdaGetAccountSettingsResponse,
} from '@/lib/api/contracts/tools/aws/lambda-get-account-settings'
import type {
  AwsLambdaGetAliasRequest,
  AwsLambdaGetAliasResponse,
} from '@/lib/api/contracts/tools/aws/lambda-get-alias'
import type {
  AwsLambdaGetEventSourceMappingRequest,
  AwsLambdaGetEventSourceMappingResponse,
} from '@/lib/api/contracts/tools/aws/lambda-get-event-source-mapping'
import type {
  AwsLambdaGetFunctionRequest,
  AwsLambdaGetFunctionResponse,
} from '@/lib/api/contracts/tools/aws/lambda-get-function'
import type {
  AwsLambdaGetFunctionConcurrencyRequest,
  AwsLambdaGetFunctionConcurrencyResponse,
} from '@/lib/api/contracts/tools/aws/lambda-get-function-concurrency'
import type {
  AwsLambdaGetFunctionConfigurationRequest,
  AwsLambdaGetFunctionConfigurationResponse,
} from '@/lib/api/contracts/tools/aws/lambda-get-function-configuration'
import type {
  AwsLambdaGetFunctionEventInvokeConfigRequest,
  AwsLambdaGetFunctionEventInvokeConfigResponse,
} from '@/lib/api/contracts/tools/aws/lambda-get-function-event-invoke-config'
import type {
  AwsLambdaGetFunctionRecursionConfigRequest,
  AwsLambdaGetFunctionRecursionConfigResponse,
} from '@/lib/api/contracts/tools/aws/lambda-get-function-recursion-config'
import type {
  AwsLambdaGetFunctionUrlConfigRequest,
  AwsLambdaGetFunctionUrlConfigResponse,
} from '@/lib/api/contracts/tools/aws/lambda-get-function-url-config'
import type {
  AwsLambdaGetLayerVersionRequest,
  AwsLambdaGetLayerVersionResponse,
} from '@/lib/api/contracts/tools/aws/lambda-get-layer-version'
import type {
  AwsLambdaGetPolicyRequest,
  AwsLambdaGetPolicyResponse,
} from '@/lib/api/contracts/tools/aws/lambda-get-policy'
import type {
  AwsLambdaGetProvisionedConcurrencyConfigRequest,
  AwsLambdaGetProvisionedConcurrencyConfigResponse,
} from '@/lib/api/contracts/tools/aws/lambda-get-provisioned-concurrency-config'
import type {
  AwsLambdaGetRuntimeManagementConfigRequest,
  AwsLambdaGetRuntimeManagementConfigResponse,
} from '@/lib/api/contracts/tools/aws/lambda-get-runtime-management-config'
import type {
  AwsLambdaInvokeRequest,
  AwsLambdaInvokeResponse,
} from '@/lib/api/contracts/tools/aws/lambda-invoke'
import type {
  AwsLambdaListAliasesRequest,
  AwsLambdaListAliasesResponse,
} from '@/lib/api/contracts/tools/aws/lambda-list-aliases'
import type {
  AwsLambdaListEventSourceMappingsRequest,
  AwsLambdaListEventSourceMappingsResponse,
} from '@/lib/api/contracts/tools/aws/lambda-list-event-source-mappings'
import type {
  AwsLambdaListFunctionEventInvokeConfigsRequest,
  AwsLambdaListFunctionEventInvokeConfigsResponse,
} from '@/lib/api/contracts/tools/aws/lambda-list-function-event-invoke-configs'
import type {
  AwsLambdaListFunctionUrlConfigsRequest,
  AwsLambdaListFunctionUrlConfigsResponse,
} from '@/lib/api/contracts/tools/aws/lambda-list-function-url-configs'
import type {
  AwsLambdaListFunctionsRequest,
  AwsLambdaListFunctionsResponse,
} from '@/lib/api/contracts/tools/aws/lambda-list-functions'
import type {
  AwsLambdaListLayerVersionsRequest,
  AwsLambdaListLayerVersionsResponse,
} from '@/lib/api/contracts/tools/aws/lambda-list-layer-versions'
import type {
  AwsLambdaListLayersRequest,
  AwsLambdaListLayersResponse,
} from '@/lib/api/contracts/tools/aws/lambda-list-layers'
import type {
  AwsLambdaListProvisionedConcurrencyConfigsRequest,
  AwsLambdaListProvisionedConcurrencyConfigsResponse,
} from '@/lib/api/contracts/tools/aws/lambda-list-provisioned-concurrency-configs'
import type {
  AwsLambdaListTagsRequest,
  AwsLambdaListTagsResponse,
} from '@/lib/api/contracts/tools/aws/lambda-list-tags'
import type {
  AwsLambdaListVersionsByFunctionRequest,
  AwsLambdaListVersionsByFunctionResponse,
} from '@/lib/api/contracts/tools/aws/lambda-list-versions-by-function'
import type {
  AwsLambdaPublishVersionRequest,
  AwsLambdaPublishVersionResponse,
} from '@/lib/api/contracts/tools/aws/lambda-publish-version'
import type {
  AwsLambdaPutFunctionConcurrencyRequest,
  AwsLambdaPutFunctionConcurrencyResponse,
} from '@/lib/api/contracts/tools/aws/lambda-put-function-concurrency'
import type {
  AwsLambdaPutFunctionEventInvokeConfigRequest,
  AwsLambdaPutFunctionEventInvokeConfigResponse,
} from '@/lib/api/contracts/tools/aws/lambda-put-function-event-invoke-config'
import type {
  AwsLambdaPutFunctionRecursionConfigRequest,
  AwsLambdaPutFunctionRecursionConfigResponse,
} from '@/lib/api/contracts/tools/aws/lambda-put-function-recursion-config'
import type {
  AwsLambdaPutProvisionedConcurrencyConfigRequest,
  AwsLambdaPutProvisionedConcurrencyConfigResponse,
} from '@/lib/api/contracts/tools/aws/lambda-put-provisioned-concurrency-config'
import type {
  AwsLambdaPutRuntimeManagementConfigRequest,
  AwsLambdaPutRuntimeManagementConfigResponse,
} from '@/lib/api/contracts/tools/aws/lambda-put-runtime-management-config'
import type {
  AwsLambdaRemovePermissionRequest,
  AwsLambdaRemovePermissionResponse,
} from '@/lib/api/contracts/tools/aws/lambda-remove-permission'
import type {
  AwsLambdaTagResourceRequest,
  AwsLambdaTagResourceResponse,
} from '@/lib/api/contracts/tools/aws/lambda-tag-resource'
import type {
  AwsLambdaUntagResourceRequest,
  AwsLambdaUntagResourceResponse,
} from '@/lib/api/contracts/tools/aws/lambda-untag-resource'
import type {
  AwsLambdaUpdateAliasRequest,
  AwsLambdaUpdateAliasResponse,
} from '@/lib/api/contracts/tools/aws/lambda-update-alias'
import type {
  AwsLambdaUpdateEventSourceMappingRequest,
  AwsLambdaUpdateEventSourceMappingResponse,
} from '@/lib/api/contracts/tools/aws/lambda-update-event-source-mapping'
import type {
  AwsLambdaUpdateFunctionCodeRequest,
  AwsLambdaUpdateFunctionCodeResponse,
} from '@/lib/api/contracts/tools/aws/lambda-update-function-code'
import type {
  AwsLambdaUpdateFunctionConfigurationRequest,
  AwsLambdaUpdateFunctionConfigurationResponse,
} from '@/lib/api/contracts/tools/aws/lambda-update-function-configuration'
import type {
  AwsLambdaUpdateFunctionUrlConfigRequest,
  AwsLambdaUpdateFunctionUrlConfigResponse,
} from '@/lib/api/contracts/tools/aws/lambda-update-function-url-config'
import type { ToolResponse } from '@/tools/types'

/**
 * Credential params every Lambda tool declares. The tool's `operation.input` renames
 * these onto the `region`/`accessKeyId`/`secretAccessKey` fields the contract expects.
 */
export interface LambdaConnectionParams {
  awsRegion: string
  awsAccessKeyId: string
  awsSecretAccessKey: string
}

export interface LambdaInvokeParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaInvokeRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaInvokeResponse extends ToolResponse {
  output: AwsLambdaInvokeResponse['output']
}

export interface LambdaListFunctionsParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaListFunctionsRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaListFunctionsResponse extends ToolResponse {
  output: AwsLambdaListFunctionsResponse['output']
}

export interface LambdaGetFunctionParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaGetFunctionRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaGetFunctionResponse extends ToolResponse {
  output: AwsLambdaGetFunctionResponse['output']
}

export interface LambdaGetFunctionConfigurationParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaGetFunctionConfigurationRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaGetFunctionConfigurationResponse extends ToolResponse {
  output: AwsLambdaGetFunctionConfigurationResponse['output']
}

export interface LambdaCreateFunctionParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaCreateFunctionRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaCreateFunctionResponse extends ToolResponse {
  output: AwsLambdaCreateFunctionResponse['output']
}

export interface LambdaUpdateFunctionCodeParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaUpdateFunctionCodeRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaUpdateFunctionCodeResponse extends ToolResponse {
  output: AwsLambdaUpdateFunctionCodeResponse['output']
}

export interface LambdaUpdateFunctionConfigurationParams
  extends LambdaConnectionParams,
    Omit<
      AwsLambdaUpdateFunctionConfigurationRequest,
      'region' | 'accessKeyId' | 'secretAccessKey'
    > {}

export interface LambdaUpdateFunctionConfigurationResponse extends ToolResponse {
  output: AwsLambdaUpdateFunctionConfigurationResponse['output']
}

export interface LambdaDeleteFunctionParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaDeleteFunctionRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaDeleteFunctionResponse extends ToolResponse {
  output: AwsLambdaDeleteFunctionResponse['output']
}

export interface LambdaPublishVersionParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaPublishVersionRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaPublishVersionResponse extends ToolResponse {
  output: AwsLambdaPublishVersionResponse['output']
}

export interface LambdaListVersionsByFunctionParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaListVersionsByFunctionRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaListVersionsByFunctionResponse extends ToolResponse {
  output: AwsLambdaListVersionsByFunctionResponse['output']
}

export interface LambdaCreateAliasParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaCreateAliasRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaCreateAliasResponse extends ToolResponse {
  output: AwsLambdaCreateAliasResponse['output']
}

export interface LambdaGetAliasParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaGetAliasRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaGetAliasResponse extends ToolResponse {
  output: AwsLambdaGetAliasResponse['output']
}

export interface LambdaUpdateAliasParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaUpdateAliasRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaUpdateAliasResponse extends ToolResponse {
  output: AwsLambdaUpdateAliasResponse['output']
}

export interface LambdaDeleteAliasParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaDeleteAliasRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaDeleteAliasResponse extends ToolResponse {
  output: AwsLambdaDeleteAliasResponse['output']
}

export interface LambdaListAliasesParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaListAliasesRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaListAliasesResponse extends ToolResponse {
  output: AwsLambdaListAliasesResponse['output']
}

export interface LambdaAddPermissionParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaAddPermissionRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaAddPermissionResponse extends ToolResponse {
  output: AwsLambdaAddPermissionResponse['output']
}

export interface LambdaRemovePermissionParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaRemovePermissionRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaRemovePermissionResponse extends ToolResponse {
  output: AwsLambdaRemovePermissionResponse['output']
}

export interface LambdaGetPolicyParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaGetPolicyRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaGetPolicyResponse extends ToolResponse {
  output: AwsLambdaGetPolicyResponse['output']
}

export interface LambdaCreateEventSourceMappingParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaCreateEventSourceMappingRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaCreateEventSourceMappingResponse extends ToolResponse {
  output: AwsLambdaCreateEventSourceMappingResponse['output']
}

export interface LambdaGetEventSourceMappingParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaGetEventSourceMappingRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaGetEventSourceMappingResponse extends ToolResponse {
  output: AwsLambdaGetEventSourceMappingResponse['output']
}

export interface LambdaUpdateEventSourceMappingParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaUpdateEventSourceMappingRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaUpdateEventSourceMappingResponse extends ToolResponse {
  output: AwsLambdaUpdateEventSourceMappingResponse['output']
}

export interface LambdaDeleteEventSourceMappingParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaDeleteEventSourceMappingRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaDeleteEventSourceMappingResponse extends ToolResponse {
  output: AwsLambdaDeleteEventSourceMappingResponse['output']
}

export interface LambdaListEventSourceMappingsParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaListEventSourceMappingsRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaListEventSourceMappingsResponse extends ToolResponse {
  output: AwsLambdaListEventSourceMappingsResponse['output']
}

export interface LambdaGetFunctionConcurrencyParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaGetFunctionConcurrencyRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaGetFunctionConcurrencyResponse extends ToolResponse {
  output: AwsLambdaGetFunctionConcurrencyResponse['output']
}

export interface LambdaPutFunctionConcurrencyParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaPutFunctionConcurrencyRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaPutFunctionConcurrencyResponse extends ToolResponse {
  output: AwsLambdaPutFunctionConcurrencyResponse['output']
}

export interface LambdaDeleteFunctionConcurrencyParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaDeleteFunctionConcurrencyRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaDeleteFunctionConcurrencyResponse extends ToolResponse {
  output: AwsLambdaDeleteFunctionConcurrencyResponse['output']
}

export interface LambdaGetProvisionedConcurrencyConfigParams
  extends LambdaConnectionParams,
    Omit<
      AwsLambdaGetProvisionedConcurrencyConfigRequest,
      'region' | 'accessKeyId' | 'secretAccessKey'
    > {}

export interface LambdaGetProvisionedConcurrencyConfigResponse extends ToolResponse {
  output: AwsLambdaGetProvisionedConcurrencyConfigResponse['output']
}

export interface LambdaPutProvisionedConcurrencyConfigParams
  extends LambdaConnectionParams,
    Omit<
      AwsLambdaPutProvisionedConcurrencyConfigRequest,
      'region' | 'accessKeyId' | 'secretAccessKey'
    > {}

export interface LambdaPutProvisionedConcurrencyConfigResponse extends ToolResponse {
  output: AwsLambdaPutProvisionedConcurrencyConfigResponse['output']
}

export interface LambdaDeleteProvisionedConcurrencyConfigParams
  extends LambdaConnectionParams,
    Omit<
      AwsLambdaDeleteProvisionedConcurrencyConfigRequest,
      'region' | 'accessKeyId' | 'secretAccessKey'
    > {}

export interface LambdaDeleteProvisionedConcurrencyConfigResponse extends ToolResponse {
  output: AwsLambdaDeleteProvisionedConcurrencyConfigResponse['output']
}

export interface LambdaListProvisionedConcurrencyConfigsParams
  extends LambdaConnectionParams,
    Omit<
      AwsLambdaListProvisionedConcurrencyConfigsRequest,
      'region' | 'accessKeyId' | 'secretAccessKey'
    > {}

export interface LambdaListProvisionedConcurrencyConfigsResponse extends ToolResponse {
  output: AwsLambdaListProvisionedConcurrencyConfigsResponse['output']
}

export interface LambdaCreateFunctionUrlConfigParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaCreateFunctionUrlConfigRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaCreateFunctionUrlConfigResponse extends ToolResponse {
  output: AwsLambdaCreateFunctionUrlConfigResponse['output']
}

export interface LambdaGetFunctionUrlConfigParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaGetFunctionUrlConfigRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaGetFunctionUrlConfigResponse extends ToolResponse {
  output: AwsLambdaGetFunctionUrlConfigResponse['output']
}

export interface LambdaUpdateFunctionUrlConfigParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaUpdateFunctionUrlConfigRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaUpdateFunctionUrlConfigResponse extends ToolResponse {
  output: AwsLambdaUpdateFunctionUrlConfigResponse['output']
}

export interface LambdaDeleteFunctionUrlConfigParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaDeleteFunctionUrlConfigRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaDeleteFunctionUrlConfigResponse extends ToolResponse {
  output: AwsLambdaDeleteFunctionUrlConfigResponse['output']
}

export interface LambdaListFunctionUrlConfigsParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaListFunctionUrlConfigsRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaListFunctionUrlConfigsResponse extends ToolResponse {
  output: AwsLambdaListFunctionUrlConfigsResponse['output']
}

export interface LambdaGetFunctionEventInvokeConfigParams
  extends LambdaConnectionParams,
    Omit<
      AwsLambdaGetFunctionEventInvokeConfigRequest,
      'region' | 'accessKeyId' | 'secretAccessKey'
    > {}

export interface LambdaGetFunctionEventInvokeConfigResponse extends ToolResponse {
  output: AwsLambdaGetFunctionEventInvokeConfigResponse['output']
}

export interface LambdaPutFunctionEventInvokeConfigParams
  extends LambdaConnectionParams,
    Omit<
      AwsLambdaPutFunctionEventInvokeConfigRequest,
      'region' | 'accessKeyId' | 'secretAccessKey'
    > {}

export interface LambdaPutFunctionEventInvokeConfigResponse extends ToolResponse {
  output: AwsLambdaPutFunctionEventInvokeConfigResponse['output']
}

export interface LambdaDeleteFunctionEventInvokeConfigParams
  extends LambdaConnectionParams,
    Omit<
      AwsLambdaDeleteFunctionEventInvokeConfigRequest,
      'region' | 'accessKeyId' | 'secretAccessKey'
    > {}

export interface LambdaDeleteFunctionEventInvokeConfigResponse extends ToolResponse {
  output: AwsLambdaDeleteFunctionEventInvokeConfigResponse['output']
}

export interface LambdaListFunctionEventInvokeConfigsParams
  extends LambdaConnectionParams,
    Omit<
      AwsLambdaListFunctionEventInvokeConfigsRequest,
      'region' | 'accessKeyId' | 'secretAccessKey'
    > {}

export interface LambdaListFunctionEventInvokeConfigsResponse extends ToolResponse {
  output: AwsLambdaListFunctionEventInvokeConfigsResponse['output']
}

export interface LambdaListLayersParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaListLayersRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaListLayersResponse extends ToolResponse {
  output: AwsLambdaListLayersResponse['output']
}

export interface LambdaListLayerVersionsParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaListLayerVersionsRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaListLayerVersionsResponse extends ToolResponse {
  output: AwsLambdaListLayerVersionsResponse['output']
}

export interface LambdaGetLayerVersionParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaGetLayerVersionRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaGetLayerVersionResponse extends ToolResponse {
  output: AwsLambdaGetLayerVersionResponse['output']
}

export interface LambdaListTagsParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaListTagsRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaListTagsResponse extends ToolResponse {
  output: AwsLambdaListTagsResponse['output']
}

export interface LambdaTagResourceParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaTagResourceRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaTagResourceResponse extends ToolResponse {
  output: AwsLambdaTagResourceResponse['output']
}

export interface LambdaUntagResourceParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaUntagResourceRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaUntagResourceResponse extends ToolResponse {
  output: AwsLambdaUntagResourceResponse['output']
}

export interface LambdaGetAccountSettingsParams
  extends LambdaConnectionParams,
    Omit<AwsLambdaGetAccountSettingsRequest, 'region' | 'accessKeyId' | 'secretAccessKey'> {}

export interface LambdaGetAccountSettingsResponse extends ToolResponse {
  output: AwsLambdaGetAccountSettingsResponse['output']
}

export interface LambdaGetFunctionRecursionConfigParams
  extends LambdaConnectionParams,
    Omit<
      AwsLambdaGetFunctionRecursionConfigRequest,
      'region' | 'accessKeyId' | 'secretAccessKey'
    > {}

export interface LambdaGetFunctionRecursionConfigResponse extends ToolResponse {
  output: AwsLambdaGetFunctionRecursionConfigResponse['output']
}

export interface LambdaPutFunctionRecursionConfigParams
  extends LambdaConnectionParams,
    Omit<
      AwsLambdaPutFunctionRecursionConfigRequest,
      'region' | 'accessKeyId' | 'secretAccessKey'
    > {}

export interface LambdaPutFunctionRecursionConfigResponse extends ToolResponse {
  output: AwsLambdaPutFunctionRecursionConfigResponse['output']
}

export interface LambdaGetRuntimeManagementConfigParams
  extends LambdaConnectionParams,
    Omit<
      AwsLambdaGetRuntimeManagementConfigRequest,
      'region' | 'accessKeyId' | 'secretAccessKey'
    > {}

export interface LambdaGetRuntimeManagementConfigResponse extends ToolResponse {
  output: AwsLambdaGetRuntimeManagementConfigResponse['output']
}

export interface LambdaPutRuntimeManagementConfigParams
  extends LambdaConnectionParams,
    Omit<
      AwsLambdaPutRuntimeManagementConfigRequest,
      'region' | 'accessKeyId' | 'secretAccessKey'
    > {}

export interface LambdaPutRuntimeManagementConfigResponse extends ToolResponse {
  output: AwsLambdaPutRuntimeManagementConfigResponse['output']
}

export type LambdaResponse =
  | LambdaInvokeResponse
  | LambdaListFunctionsResponse
  | LambdaGetFunctionResponse
  | LambdaGetFunctionConfigurationResponse
  | LambdaCreateFunctionResponse
  | LambdaUpdateFunctionCodeResponse
  | LambdaUpdateFunctionConfigurationResponse
  | LambdaDeleteFunctionResponse
  | LambdaPublishVersionResponse
  | LambdaListVersionsByFunctionResponse
  | LambdaCreateAliasResponse
  | LambdaGetAliasResponse
  | LambdaUpdateAliasResponse
  | LambdaDeleteAliasResponse
  | LambdaListAliasesResponse
  | LambdaAddPermissionResponse
  | LambdaRemovePermissionResponse
  | LambdaGetPolicyResponse
  | LambdaCreateEventSourceMappingResponse
  | LambdaGetEventSourceMappingResponse
  | LambdaUpdateEventSourceMappingResponse
  | LambdaDeleteEventSourceMappingResponse
  | LambdaListEventSourceMappingsResponse
  | LambdaGetFunctionConcurrencyResponse
  | LambdaPutFunctionConcurrencyResponse
  | LambdaDeleteFunctionConcurrencyResponse
  | LambdaGetProvisionedConcurrencyConfigResponse
  | LambdaPutProvisionedConcurrencyConfigResponse
  | LambdaDeleteProvisionedConcurrencyConfigResponse
  | LambdaListProvisionedConcurrencyConfigsResponse
  | LambdaCreateFunctionUrlConfigResponse
  | LambdaGetFunctionUrlConfigResponse
  | LambdaUpdateFunctionUrlConfigResponse
  | LambdaDeleteFunctionUrlConfigResponse
  | LambdaListFunctionUrlConfigsResponse
  | LambdaGetFunctionEventInvokeConfigResponse
  | LambdaPutFunctionEventInvokeConfigResponse
  | LambdaDeleteFunctionEventInvokeConfigResponse
  | LambdaListFunctionEventInvokeConfigsResponse
  | LambdaListLayersResponse
  | LambdaListLayerVersionsResponse
  | LambdaGetLayerVersionResponse
  | LambdaListTagsResponse
  | LambdaTagResourceResponse
  | LambdaUntagResourceResponse
  | LambdaGetAccountSettingsResponse
  | LambdaGetFunctionRecursionConfigResponse
  | LambdaPutFunctionRecursionConfigResponse
  | LambdaGetRuntimeManagementConfigResponse
  | LambdaPutRuntimeManagementConfigResponse
