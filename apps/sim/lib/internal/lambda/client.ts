import {
  type AliasConfiguration,
  type EventSourceMappingConfiguration,
  type FunctionConfiguration,
  type FunctionEventInvokeConfig,
  type FunctionUrlConfig,
  LambdaClient,
  type LayersListItem,
  type LayerVersionsListItem,
} from '@aws-sdk/client-lambda'

export interface LambdaConnectionConfig {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export function createLambdaClient(config: LambdaConnectionConfig): LambdaClient {
  return new LambdaClient({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}

/** Normalizes an SDK `Date` field to an ISO-8601 string so it survives JSON transport. */
function toIsoString(value?: Date): string | null {
  return value ? value.toISOString() : null
}

/**
 * Decodes the base64 `LogResult` header Lambda returns when `LogType` is `Tail`,
 * so callers get readable log lines instead of an opaque blob.
 */
export function decodeLogResult(logResult?: string): string | null {
  if (!logResult) return null
  try {
    return Buffer.from(logResult, 'base64').toString('utf8')
  } catch {
    return logResult
  }
}

/**
 * Decodes an invocation payload. Lambda payloads are JSON by convention but the
 * contract does not guarantee it, so an unparseable payload is returned as the raw
 * UTF-8 string rather than being dropped.
 */
export function decodeInvocationPayload(payload?: Uint8Array): unknown {
  if (!payload || payload.length === 0) return null
  const text = Buffer.from(payload).toString('utf8')
  if (text.trim() === '') return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/**
 * Encodes an invocation payload. A payload that already arrives as serialized JSON — from a
 * `<Block.output>` reference or an LLM tool call — is forwarded verbatim so the function does
 * not receive a doubly-encoded, quoted string.
 */
export function encodeInvocationPayload(payload: unknown): Uint8Array | undefined {
  if (payload === undefined) return undefined
  const encoder = new TextEncoder()
  if (typeof payload === 'string') {
    const trimmed = payload.trim()
    if (trimmed !== '') {
      try {
        JSON.parse(trimmed)
        return encoder.encode(trimmed)
      } catch {
        // Not JSON; fall through and send it as a JSON string literal.
      }
    }
  }
  return encoder.encode(JSON.stringify(payload))
}

const destinationConfigOf = (
  config?:
    | { OnSuccess?: { Destination?: string }; OnFailure?: { Destination?: string } }
    | undefined
) =>
  config
    ? {
        onSuccessDestination: config.OnSuccess?.Destination ?? null,
        onFailureDestination: config.OnFailure?.Destination ?? null,
      }
    : null

/** Projects the SDK `FunctionConfiguration` shape onto the block's camelCase output contract. */
export function mapFunctionConfiguration(fc: FunctionConfiguration) {
  const capacityProvider =
    fc.CapacityProviderConfig?.LambdaManagedInstancesCapacityProviderConfig ?? null

  return {
    functionName: fc.FunctionName ?? null,
    functionArn: fc.FunctionArn ?? null,
    runtime: fc.Runtime ?? null,
    role: fc.Role ?? null,
    handler: fc.Handler ?? null,
    codeSize: fc.CodeSize ?? null,
    description: fc.Description ?? null,
    timeout: fc.Timeout ?? null,
    memorySize: fc.MemorySize ?? null,
    lastModified: fc.LastModified ?? null,
    codeSha256: fc.CodeSha256 ?? null,
    configSha256: fc.ConfigSha256 ?? null,
    version: fc.Version ?? null,
    masterArn: fc.MasterArn ?? null,
    revisionId: fc.RevisionId ?? null,
    kmsKeyArn: fc.KMSKeyArn ?? null,
    packageType: fc.PackageType ?? null,
    state: fc.State ?? null,
    stateReason: fc.StateReason ?? null,
    stateReasonCode: fc.StateReasonCode ?? null,
    lastUpdateStatus: fc.LastUpdateStatus ?? null,
    lastUpdateStatusReason: fc.LastUpdateStatusReason ?? null,
    lastUpdateStatusReasonCode: fc.LastUpdateStatusReasonCode ?? null,
    signingProfileVersionArn: fc.SigningProfileVersionArn ?? null,
    signingJobArn: fc.SigningJobArn ?? null,
    architectures: fc.Architectures ?? [],
    ephemeralStorageSize: fc.EphemeralStorage?.Size ?? null,
    layers: (fc.Layers ?? []).map((layer) => ({
      arn: layer.Arn ?? null,
      codeSize: layer.CodeSize ?? null,
      signingProfileVersionArn: layer.SigningProfileVersionArn ?? null,
      signingJobArn: layer.SigningJobArn ?? null,
    })),
    fileSystemConfigs: (fc.FileSystemConfigs ?? []).map((config) => ({
      arn: config.Arn ?? null,
      localMountPath: config.LocalMountPath ?? null,
    })),
    vpcConfig: fc.VpcConfig
      ? {
          subnetIds: fc.VpcConfig.SubnetIds ?? [],
          securityGroupIds: fc.VpcConfig.SecurityGroupIds ?? [],
          vpcId: fc.VpcConfig.VpcId ?? null,
          ipv6AllowedForDualStack: fc.VpcConfig.Ipv6AllowedForDualStack ?? null,
        }
      : null,
    deadLetterConfig: fc.DeadLetterConfig
      ? { targetArn: fc.DeadLetterConfig.TargetArn ?? null }
      : null,
    environment: fc.Environment
      ? {
          variables: fc.Environment.Variables ?? {},
          error: fc.Environment.Error
            ? {
                errorCode: fc.Environment.Error.ErrorCode ?? null,
                message: fc.Environment.Error.Message ?? null,
              }
            : null,
        }
      : null,
    tracingConfig: fc.TracingConfig ? { mode: fc.TracingConfig.Mode ?? null } : null,
    imageConfigResponse: fc.ImageConfigResponse
      ? {
          imageConfig: fc.ImageConfigResponse.ImageConfig
            ? {
                entryPoint: fc.ImageConfigResponse.ImageConfig.EntryPoint ?? [],
                command: fc.ImageConfigResponse.ImageConfig.Command ?? [],
                workingDirectory: fc.ImageConfigResponse.ImageConfig.WorkingDirectory ?? null,
              }
            : null,
          error: fc.ImageConfigResponse.Error
            ? {
                errorCode: fc.ImageConfigResponse.Error.ErrorCode ?? null,
                message: fc.ImageConfigResponse.Error.Message ?? null,
              }
            : null,
        }
      : null,
    snapStart: fc.SnapStart
      ? {
          applyOn: fc.SnapStart.ApplyOn ?? null,
          optimizationStatus: fc.SnapStart.OptimizationStatus ?? null,
        }
      : null,
    runtimeVersionConfig: fc.RuntimeVersionConfig
      ? {
          runtimeVersionArn: fc.RuntimeVersionConfig.RuntimeVersionArn ?? null,
          error: fc.RuntimeVersionConfig.Error
            ? {
                errorCode: fc.RuntimeVersionConfig.Error.ErrorCode ?? null,
                message: fc.RuntimeVersionConfig.Error.Message ?? null,
              }
            : null,
        }
      : null,
    loggingConfig: fc.LoggingConfig
      ? {
          logFormat: fc.LoggingConfig.LogFormat ?? null,
          applicationLogLevel: fc.LoggingConfig.ApplicationLogLevel ?? null,
          systemLogLevel: fc.LoggingConfig.SystemLogLevel ?? null,
          logGroup: fc.LoggingConfig.LogGroup ?? null,
        }
      : null,
    capacityProviderConfig: capacityProvider
      ? {
          capacityProviderArn: capacityProvider.CapacityProviderArn ?? null,
          perExecutionEnvironmentMaxConcurrency:
            capacityProvider.PerExecutionEnvironmentMaxConcurrency ?? null,
          executionEnvironmentMemoryGiBPerVCpu:
            capacityProvider.ExecutionEnvironmentMemoryGiBPerVCpu ?? null,
        }
      : null,
    durableConfig: fc.DurableConfig
      ? {
          retentionPeriodInDays: fc.DurableConfig.RetentionPeriodInDays ?? null,
          executionTimeout: fc.DurableConfig.ExecutionTimeout ?? null,
        }
      : null,
    tenancyConfig: fc.TenancyConfig
      ? { tenantIsolationMode: fc.TenancyConfig.TenantIsolationMode ?? null }
      : null,
  }
}

/** Projects the SDK `AliasConfiguration` shape onto the block's camelCase output contract. */
export function mapAliasConfiguration(alias: AliasConfiguration) {
  return {
    aliasArn: alias.AliasArn ?? null,
    name: alias.Name ?? null,
    functionVersion: alias.FunctionVersion ?? null,
    description: alias.Description ?? null,
    revisionId: alias.RevisionId ?? null,
    routingConfig: alias.RoutingConfig
      ? { additionalVersionWeights: alias.RoutingConfig.AdditionalVersionWeights ?? {} }
      : null,
  }
}

/**
 * Projects the SDK `EventSourceMappingConfiguration` shape onto the block's camelCase
 * output contract, flattening the single-field `ScalingConfig`, `FilterCriteria`,
 * `MetricsConfig`, and Kafka consumer-group wrappers.
 */
export function mapEventSourceMapping(esm: EventSourceMappingConfiguration) {
  return {
    uuid: esm.UUID ?? null,
    eventSourceMappingArn: esm.EventSourceMappingArn ?? null,
    eventSourceArn: esm.EventSourceArn ?? null,
    functionArn: esm.FunctionArn ?? null,
    state: esm.State ?? null,
    stateTransitionReason: esm.StateTransitionReason ?? null,
    lastProcessingResult: esm.LastProcessingResult ?? null,
    lastModified: toIsoString(esm.LastModified),
    batchSize: esm.BatchSize ?? null,
    maximumBatchingWindowInSeconds: esm.MaximumBatchingWindowInSeconds ?? null,
    parallelizationFactor: esm.ParallelizationFactor ?? null,
    startingPosition: esm.StartingPosition ?? null,
    startingPositionTimestamp: toIsoString(esm.StartingPositionTimestamp),
    maximumRecordAgeInSeconds: esm.MaximumRecordAgeInSeconds ?? null,
    maximumRetryAttempts: esm.MaximumRetryAttempts ?? null,
    bisectBatchOnFunctionError: esm.BisectBatchOnFunctionError ?? null,
    tumblingWindowInSeconds: esm.TumblingWindowInSeconds ?? null,
    kmsKeyArn: esm.KMSKeyArn ?? null,
    maximumConcurrency: esm.ScalingConfig?.MaximumConcurrency ?? null,
    systemLogLevel: esm.LoggingConfig?.SystemLogLevel ?? null,
    amazonManagedKafkaConsumerGroupId:
      esm.AmazonManagedKafkaEventSourceConfig?.ConsumerGroupId ?? null,
    selfManagedKafkaConsumerGroupId: esm.SelfManagedKafkaEventSourceConfig?.ConsumerGroupId ?? null,
    topics: esm.Topics ?? [],
    queues: esm.Queues ?? [],
    functionResponseTypes: esm.FunctionResponseTypes ?? [],
    metrics: esm.MetricsConfig?.Metrics ?? [],
    filterCriteria: (esm.FilterCriteria?.Filters ?? []).map((filter) => ({
      pattern: filter.Pattern ?? null,
    })),
    filterCriteriaError: esm.FilterCriteriaError
      ? {
          errorCode: esm.FilterCriteriaError.ErrorCode ?? null,
          message: esm.FilterCriteriaError.Message ?? null,
        }
      : null,
    destinationConfig: destinationConfigOf(esm.DestinationConfig),
    sourceAccessConfigurations: (esm.SourceAccessConfigurations ?? []).map((config) => ({
      type: config.Type ?? null,
      uri: config.URI ?? null,
    })),
    documentDbEventSourceConfig: esm.DocumentDBEventSourceConfig
      ? {
          databaseName: esm.DocumentDBEventSourceConfig.DatabaseName ?? null,
          collectionName: esm.DocumentDBEventSourceConfig.CollectionName ?? null,
          fullDocument: esm.DocumentDBEventSourceConfig.FullDocument ?? null,
        }
      : null,
    selfManagedKafkaBootstrapServers:
      esm.SelfManagedEventSource?.Endpoints?.KAFKA_BOOTSTRAP_SERVERS ?? [],
    provisionedPollerConfig: esm.ProvisionedPollerConfig
      ? {
          minimumPollers: esm.ProvisionedPollerConfig.MinimumPollers ?? null,
          maximumPollers: esm.ProvisionedPollerConfig.MaximumPollers ?? null,
          pollerGroupName: esm.ProvisionedPollerConfig.PollerGroupName ?? null,
        }
      : null,
  }
}

/** Projects an SDK function URL configuration onto the block's camelCase output contract. */
export function mapFunctionUrlConfig(config: {
  FunctionUrl: string | undefined
  FunctionArn: string | undefined
  AuthType: string | undefined
  CreationTime: string | undefined
  LastModifiedTime?: string | undefined
  InvokeMode?: string | undefined
  Cors?: FunctionUrlConfig['Cors']
}) {
  return {
    functionUrl: config.FunctionUrl ?? null,
    functionArn: config.FunctionArn ?? null,
    authType: config.AuthType ?? null,
    creationTime: config.CreationTime ?? null,
    lastModifiedTime: config.LastModifiedTime ?? null,
    invokeMode: config.InvokeMode ?? null,
    cors: config.Cors
      ? {
          allowCredentials: config.Cors.AllowCredentials ?? null,
          allowHeaders: config.Cors.AllowHeaders ?? [],
          allowMethods: config.Cors.AllowMethods ?? [],
          allowOrigins: config.Cors.AllowOrigins ?? [],
          exposeHeaders: config.Cors.ExposeHeaders ?? [],
          maxAge: config.Cors.MaxAge ?? null,
        }
      : null,
  }
}

/** Projects the SDK `FunctionEventInvokeConfig` shape onto the block's output contract. */
export function mapEventInvokeConfig(config: FunctionEventInvokeConfig) {
  return {
    functionArn: config.FunctionArn ?? null,
    lastModified: toIsoString(config.LastModified),
    maximumRetryAttempts: config.MaximumRetryAttempts ?? null,
    maximumEventAgeInSeconds: config.MaximumEventAgeInSeconds ?? null,
    destinationConfig: destinationConfigOf(config.DestinationConfig),
  }
}

/**
 * Projects a provisioned-concurrency payload onto the block's output contract. Shared by
 * Get/Put (which have no `FunctionArn`) and the ListProvisionedConcurrencyConfigs items.
 */
export function mapProvisionedConcurrency(config: {
  FunctionArn?: string | undefined
  RequestedProvisionedConcurrentExecutions?: number | undefined
  AvailableProvisionedConcurrentExecutions?: number | undefined
  AllocatedProvisionedConcurrentExecutions?: number | undefined
  Status?: string | undefined
  StatusReason?: string | undefined
  LastModified?: string | undefined
}) {
  return {
    functionArn: config.FunctionArn ?? null,
    requestedProvisionedConcurrentExecutions:
      config.RequestedProvisionedConcurrentExecutions ?? null,
    availableProvisionedConcurrentExecutions:
      config.AvailableProvisionedConcurrentExecutions ?? null,
    allocatedProvisionedConcurrentExecutions:
      config.AllocatedProvisionedConcurrentExecutions ?? null,
    status: config.Status ?? null,
    statusReason: config.StatusReason ?? null,
    lastModified: config.LastModified ?? null,
  }
}

/** Projects the SDK `LayerVersionsListItem` shape onto the block's output contract. */
export function mapLayerVersion(version: LayerVersionsListItem) {
  return {
    layerVersionArn: version.LayerVersionArn ?? null,
    version: version.Version ?? null,
    description: version.Description ?? null,
    createdDate: version.CreatedDate ?? null,
    licenseInfo: version.LicenseInfo ?? null,
    compatibleRuntimes: version.CompatibleRuntimes ?? [],
    compatibleArchitectures: version.CompatibleArchitectures ?? [],
  }
}

/** Projects the SDK `LayersListItem` shape onto the block's output contract. */
export function mapLayer(layer: LayersListItem) {
  return {
    layerName: layer.LayerName ?? null,
    layerArn: layer.LayerArn ?? null,
    latestMatchingVersion: layer.LatestMatchingVersion
      ? mapLayerVersion(layer.LatestMatchingVersion)
      : null,
  }
}
