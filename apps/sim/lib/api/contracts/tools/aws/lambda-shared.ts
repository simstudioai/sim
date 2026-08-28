import { z } from 'zod'

/**
 * Connection fields every AWS Lambda tool contract requires. Spread into each
 * operation's body schema so the credential shape stays identical across all of them.
 */
export const lambdaConnectionFields = {
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
}

/**
 * Pagination fields for the Lambda list operations whose documented `MaxItems`
 * range is 1–10000 (ListFunctions, ListVersionsByFunction, ListAliases,
 * ListEventSourceMappings).
 */
export const lambdaPaginationFields = {
  marker: z.string().optional(),
  maxItems: z
    .number()
    .int()
    .min(1, 'maxItems must be at least 1')
    .max(10000, 'maxItems cannot exceed 10000')
    .optional(),
}

/**
 * Pagination fields for the Lambda list operations whose documented `MaxItems`
 * range is 1–50 (ListLayers, ListLayerVersions, ListFunctionUrlConfigs,
 * ListProvisionedConcurrencyConfigs, ListFunctionEventInvokeConfigs).
 */
export const lambdaSmallPaginationFields = {
  marker: z.string().optional(),
  maxItems: z
    .number()
    .int()
    .min(1, 'maxItems must be at least 1')
    .max(50, 'maxItems cannot exceed 50')
    .optional(),
}

/**
 * Documented `SourceAccessConfiguration.Type` values for an event source mapping.
 */
export const sourceAccessTypeSchema = z.enum([
  'BASIC_AUTH',
  'VPC_SUBNET',
  'VPC_SECURITY_GROUP',
  'SASL_SCRAM_512_AUTH',
  'SASL_SCRAM_256_AUTH',
  'VIRTUAL_HOST',
  'CLIENT_CERTIFICATE_TLS_AUTH',
  'SERVER_ROOT_CA_CERTIFICATE',
])

/**
 * The same set minus `VIRTUAL_HOST`, which the AWS docs state cannot be specified in an
 * UpdateEventSourceMapping call.
 */
export const updateSourceAccessTypeSchema = z.enum([
  'BASIC_AUTH',
  'VPC_SUBNET',
  'VPC_SECURITY_GROUP',
  'SASL_SCRAM_512_AUTH',
  'SASL_SCRAM_256_AUTH',
  'CLIENT_CERTIFICATE_TLS_AUTH',
  'SERVER_ROOT_CA_CERTIFICATE',
])

const errorDetailSchema = z
  .object({
    errorCode: z.string().nullable(),
    message: z.string().nullable(),
  })
  .nullable()

/**
 * Camel-cased projection of the Lambda `FunctionConfiguration` data type, returned by
 * CreateFunction, GetFunctionConfiguration, UpdateFunctionCode, UpdateFunctionConfiguration,
 * PublishVersion, ListFunctions, and ListVersionsByFunction.
 */
export const lambdaFunctionConfigurationSchema = z.object({
  functionName: z.string().nullable(),
  functionArn: z.string().nullable(),
  runtime: z.string().nullable(),
  role: z.string().nullable(),
  handler: z.string().nullable(),
  codeSize: z.number().nullable(),
  description: z.string().nullable(),
  timeout: z.number().nullable(),
  memorySize: z.number().nullable(),
  lastModified: z.string().nullable(),
  codeSha256: z.string().nullable(),
  configSha256: z.string().nullable(),
  version: z.string().nullable(),
  masterArn: z.string().nullable(),
  revisionId: z.string().nullable(),
  kmsKeyArn: z.string().nullable(),
  packageType: z.string().nullable(),
  state: z.string().nullable(),
  stateReason: z.string().nullable(),
  stateReasonCode: z.string().nullable(),
  lastUpdateStatus: z.string().nullable(),
  lastUpdateStatusReason: z.string().nullable(),
  lastUpdateStatusReasonCode: z.string().nullable(),
  signingProfileVersionArn: z.string().nullable(),
  signingJobArn: z.string().nullable(),
  architectures: z.array(z.string()),
  ephemeralStorageSize: z.number().nullable(),
  layers: z.array(
    z.object({
      arn: z.string().nullable(),
      codeSize: z.number().nullable(),
      signingProfileVersionArn: z.string().nullable(),
      signingJobArn: z.string().nullable(),
    })
  ),
  fileSystemConfigs: z.array(
    z.object({
      arn: z.string(),
      localMountPath: z.string(),
    })
  ),
  vpcConfig: z
    .object({
      subnetIds: z.array(z.string()),
      securityGroupIds: z.array(z.string()),
      vpcId: z.string().nullable(),
      ipv6AllowedForDualStack: z.boolean().nullable(),
    })
    .nullable(),
  deadLetterConfig: z.object({ targetArn: z.string().nullable() }).nullable(),
  environment: z
    .object({
      variables: z.record(z.string(), z.string()),
      error: errorDetailSchema,
    })
    .nullable(),
  tracingConfig: z.object({ mode: z.string().nullable() }).nullable(),
  imageConfigResponse: z
    .object({
      imageConfig: z
        .object({
          entryPoint: z.array(z.string()),
          command: z.array(z.string()),
          workingDirectory: z.string().nullable(),
        })
        .nullable(),
      error: errorDetailSchema,
    })
    .nullable(),
  snapStart: z
    .object({
      applyOn: z.string().nullable(),
      optimizationStatus: z.string().nullable(),
    })
    .nullable(),
  runtimeVersionConfig: z
    .object({
      runtimeVersionArn: z.string().nullable(),
      error: errorDetailSchema,
    })
    .nullable(),
  loggingConfig: z
    .object({
      logFormat: z.string().nullable(),
      applicationLogLevel: z.string().nullable(),
      systemLogLevel: z.string().nullable(),
      logGroup: z.string().nullable(),
    })
    .nullable(),
  capacityProviderConfig: z
    .object({
      capacityProviderArn: z.string().nullable(),
      perExecutionEnvironmentMaxConcurrency: z.number().nullable(),
      executionEnvironmentMemoryGiBPerVCpu: z.number().nullable(),
    })
    .nullable(),
  durableConfig: z
    .object({
      retentionPeriodInDays: z.number().nullable(),
      executionTimeout: z.number().nullable(),
    })
    .nullable(),
  tenancyConfig: z.object({ tenantIsolationMode: z.string().nullable() }).nullable(),
})

/** Camel-cased projection of the Lambda `AliasConfiguration` data type. */
export const lambdaAliasSchema = z.object({
  aliasArn: z.string().nullable(),
  name: z.string().nullable(),
  functionVersion: z.string().nullable(),
  description: z.string().nullable(),
  revisionId: z.string().nullable(),
  routingConfig: z
    .object({ additionalVersionWeights: z.record(z.string(), z.number()) })
    .nullable(),
})

const destinationConfigSchema = z
  .object({
    onSuccessDestination: z.string().nullable(),
    onFailureDestination: z.string().nullable(),
  })
  .nullable()

/** Camel-cased projection of the Lambda `EventSourceMappingConfiguration` data type. */
export const lambdaEventSourceMappingSchema = z.object({
  uuid: z.string().nullable(),
  eventSourceMappingArn: z.string().nullable(),
  eventSourceArn: z.string().nullable(),
  functionArn: z.string().nullable(),
  state: z.string().nullable(),
  stateTransitionReason: z.string().nullable(),
  lastProcessingResult: z.string().nullable(),
  lastModified: z.string().nullable(),
  batchSize: z.number().nullable(),
  maximumBatchingWindowInSeconds: z.number().nullable(),
  parallelizationFactor: z.number().nullable(),
  startingPosition: z.string().nullable(),
  startingPositionTimestamp: z.string().nullable(),
  maximumRecordAgeInSeconds: z.number().nullable(),
  maximumRetryAttempts: z.number().nullable(),
  bisectBatchOnFunctionError: z.boolean().nullable(),
  tumblingWindowInSeconds: z.number().nullable(),
  kmsKeyArn: z.string().nullable(),
  maximumConcurrency: z.number().nullable(),
  systemLogLevel: z.string().nullable(),
  amazonManagedKafkaConsumerGroupId: z.string().nullable(),
  selfManagedKafkaConsumerGroupId: z.string().nullable(),
  topics: z.array(z.string()),
  queues: z.array(z.string()),
  functionResponseTypes: z.array(z.string()),
  metrics: z.array(z.string()),
  filterCriteria: z.array(z.object({ pattern: z.string().nullable() })),
  filterCriteriaError: errorDetailSchema,
  destinationConfig: destinationConfigSchema,
  sourceAccessConfigurations: z.array(
    z.object({
      type: z.string().nullable(),
      uri: z.string().nullable(),
    })
  ),
  documentDbEventSourceConfig: z
    .object({
      databaseName: z.string().nullable(),
      collectionName: z.string().nullable(),
      fullDocument: z.string().nullable(),
    })
    .nullable(),
  provisionedPollerConfig: z
    .object({
      minimumPollers: z.number().nullable(),
      maximumPollers: z.number().nullable(),
      pollerGroupName: z.string().nullable(),
    })
    .nullable(),
})

/** Camel-cased projection of the Lambda `FunctionUrlConfig` data type. */
export const lambdaFunctionUrlConfigSchema = z.object({
  functionUrl: z.string(),
  functionArn: z.string(),
  authType: z.string(),
  creationTime: z.string(),
  lastModifiedTime: z.string().nullable(),
  invokeMode: z.string().nullable(),
  cors: z
    .object({
      allowCredentials: z.boolean().nullable(),
      allowHeaders: z.array(z.string()),
      allowMethods: z.array(z.string()),
      allowOrigins: z.array(z.string()),
      exposeHeaders: z.array(z.string()),
      maxAge: z.number().nullable(),
    })
    .nullable(),
})

/** Camel-cased projection of the Lambda `FunctionEventInvokeConfig` data type. */
export const lambdaEventInvokeConfigSchema = z.object({
  functionArn: z.string().nullable(),
  lastModified: z.string().nullable(),
  maximumRetryAttempts: z.number().nullable(),
  maximumEventAgeInSeconds: z.number().nullable(),
  destinationConfig: destinationConfigSchema,
})

/**
 * Camel-cased projection shared by GetProvisionedConcurrencyConfig,
 * PutProvisionedConcurrencyConfig, and the items of ListProvisionedConcurrencyConfigs.
 * `functionArn` is only present on the list items.
 */
export const lambdaProvisionedConcurrencySchema = z.object({
  functionArn: z.string().nullable(),
  requestedProvisionedConcurrentExecutions: z.number().nullable(),
  availableProvisionedConcurrentExecutions: z.number().nullable(),
  allocatedProvisionedConcurrentExecutions: z.number().nullable(),
  status: z.string().nullable(),
  statusReason: z.string().nullable(),
  lastModified: z.string().nullable(),
})

/** Camel-cased projection of the Lambda `LayerVersionsListItem` data type. */
export const lambdaLayerVersionSchema = z.object({
  layerVersionArn: z.string().nullable(),
  version: z.number().nullable(),
  description: z.string().nullable(),
  createdDate: z.string().nullable(),
  licenseInfo: z.string().nullable(),
  compatibleRuntimes: z.array(z.string()),
  compatibleArchitectures: z.array(z.string()),
})

/** Camel-cased projection of the Lambda `LayersListItem` data type. */
export const lambdaLayerSchema = z.object({
  layerName: z.string().nullable(),
  layerArn: z.string().nullable(),
  latestMatchingVersion: lambdaLayerVersionSchema.nullable(),
})

/** Response envelope for operations whose only meaningful output is a status message. */
export const lambdaMessageResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({ message: z.string() }),
})
