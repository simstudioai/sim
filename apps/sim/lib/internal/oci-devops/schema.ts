import { z } from 'zod'

/** OCI DevOps 20210630 request models. Unknown request fields are rejected. */
const definedTagsSchema = z.record(
  z.string().max(255),
  z.record(z.string().max(255), z.union([z.string().max(8192), z.number().int(), z.boolean()]))
)

const buildPipelineParameterSchema = z
  .object({
    defaultValue: z.string().min(1).max(1024),
    description: z.string().max(400).optional(),
    name: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[a-zA-Z][a-zA-Z_0-9]*$/),
  })
  .strict()

const buildPipelineParameterCollectionSchema = z
  .object({
    items: z.array(buildPipelineParameterSchema).max(100),
  })
  .strict()

const buildPipelineStagePredecessorSchema = z
  .object({
    id: z.string().max(8192),
  })
  .strict()

const buildPipelineStagePredecessorCollectionSchema = z
  .object({
    items: z.array(buildPipelineStagePredecessorSchema).max(100),
  })
  .strict()

const customBuildRunnerShapeConfigSchema = z
  .object({
    buildRunnerType: z.literal('CUSTOM'),
    memoryInGBs: z.number().int().min(1).max(1024),
    ocpus: z.number().int().min(1).max(64),
  })
  .strict()

const defaultBuildRunnerShapeConfigSchema = z
  .object({
    buildRunnerType: z.literal('DEFAULT'),
  })
  .strict()

const buildRunnerShapeConfigSchema = z.discriminatedUnion('buildRunnerType', [
  customBuildRunnerShapeConfigSchema,
  defaultBuildRunnerShapeConfigSchema,
])

const bitbucketCloudBuildSourceSchema = z
  .object({
    branch: z.string().max(8192),
    connectionType: z.literal('BITBUCKET_CLOUD'),
    name: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[a-zA-Z_]{1,}[a-zA-Z0-9_-]{0,}$/),
    repositoryUrl: z.string().max(8192),
    connectionId: z.string().min(1).max(255),
  })
  .strict()

const bitbucketServerBuildSourceSchema = z
  .object({
    branch: z.string().max(8192),
    connectionType: z.literal('BITBUCKET_SERVER'),
    name: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[a-zA-Z_]{1,}[a-zA-Z0-9_-]{0,}$/),
    repositoryUrl: z.string().max(8192),
    connectionId: z.string().min(1).max(255),
  })
  .strict()

const devopsCodeRepositoryBuildSourceSchema = z
  .object({
    branch: z.string().max(8192),
    connectionType: z.literal('DEVOPS_CODE_REPOSITORY'),
    name: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[a-zA-Z_]{1,}[a-zA-Z0-9_-]{0,}$/),
    repositoryUrl: z.string().max(8192),
    repositoryId: z.string().max(8192),
  })
  .strict()

const githubBuildSourceSchema = z
  .object({
    branch: z.string().max(8192),
    connectionType: z.literal('GITHUB'),
    name: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[a-zA-Z_]{1,}[a-zA-Z0-9_-]{0,}$/),
    repositoryUrl: z.string().max(8192),
    connectionId: z.string().max(8192),
  })
  .strict()

const gitlabBuildSourceSchema = z
  .object({
    branch: z.string().max(8192),
    connectionType: z.literal('GITLAB'),
    name: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[a-zA-Z_]{1,}[a-zA-Z0-9_-]{0,}$/),
    repositoryUrl: z.string().max(8192),
    connectionId: z.string().max(8192),
  })
  .strict()

const gitlabServerBuildSourceSchema = z
  .object({
    branch: z.string().max(8192),
    connectionType: z.literal('GITLAB_SERVER'),
    name: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[a-zA-Z_]{1,}[a-zA-Z0-9_-]{0,}$/),
    repositoryUrl: z.string().max(8192),
    connectionId: z.string().min(1).max(255),
  })
  .strict()

const vbsBuildSourceSchema = z
  .object({
    branch: z.string().max(8192),
    connectionType: z.literal('VBS'),
    name: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[a-zA-Z_]{1,}[a-zA-Z0-9_-]{0,}$/),
    repositoryUrl: z.string().max(8192),
    connectionId: z.string().min(1).max(255),
  })
  .strict()

const buildSourceSchema = z.discriminatedUnion('connectionType', [
  bitbucketCloudBuildSourceSchema,
  bitbucketServerBuildSourceSchema,
  devopsCodeRepositoryBuildSourceSchema,
  githubBuildSourceSchema,
  gitlabBuildSourceSchema,
  gitlabServerBuildSourceSchema,
  vbsBuildSourceSchema,
])

const buildSourceCollectionSchema = z
  .object({
    items: z.array(buildSourceSchema).max(100),
  })
  .strict()

const privateEndpointChannelSchema = z
  .object({
    networkChannelType: z.literal('PRIVATE_ENDPOINT_CHANNEL'),
    nsgIds: z.array(z.string().max(8192)).max(100).optional(),
    subnetId: z.string().min(1).max(255),
  })
  .strict()

const serviceVnicChannelSchema = z
  .object({
    networkChannelType: z.literal('SERVICE_VNIC_CHANNEL'),
    nsgIds: z.array(z.string().max(8192)).max(100).optional(),
    subnetId: z.string().min(1).max(255),
  })
  .strict()

const networkChannelSchema = z.discriminatedUnion('networkChannelType', [
  privateEndpointChannelSchema,
  serviceVnicChannelSchema,
])

const createBuildStageDetailsSchema = z
  .object({
    buildPipelineId: z.string().min(1).max(255),
    buildPipelineStagePredecessorCollection: buildPipelineStagePredecessorCollectionSchema,
    buildPipelineStageType: z.literal('BUILD'),
    definedTags: definedTagsSchema.optional(),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    buildRunnerShapeConfig: buildRunnerShapeConfigSchema.optional(),
    buildSourceCollection: buildSourceCollectionSchema,
    buildSpecFile: z.string().max(8192).optional(),
    image: z.literal('OL7_X86_64_STANDARD_10'),
    primaryBuildSource: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[a-zA-Z_]{1,}[a-zA-Z0-9_-]{0,}$/)
      .optional(),
    privateAccessConfig: networkChannelSchema.optional(),
    stageExecutionTimeoutInSeconds: z.number().int().optional(),
  })
  .strict()

const deliverArtifactSchema = z
  .object({
    artifactId: z.string().max(8192),
    artifactName: z.string().max(8192),
  })
  .strict()

const deliverArtifactCollectionSchema = z
  .object({
    items: z.array(deliverArtifactSchema).max(100),
  })
  .strict()

const createDeliverArtifactStageDetailsSchema = z
  .object({
    buildPipelineId: z.string().min(1).max(255),
    buildPipelineStagePredecessorCollection: buildPipelineStagePredecessorCollectionSchema,
    buildPipelineStageType: z.literal('DELIVER_ARTIFACT'),
    definedTags: definedTagsSchema.optional(),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    deliverArtifactCollection: deliverArtifactCollectionSchema,
  })
  .strict()

const createTriggerDeploymentStageDetailsSchema = z
  .object({
    buildPipelineId: z.string().min(1).max(255),
    buildPipelineStagePredecessorCollection: buildPipelineStagePredecessorCollectionSchema,
    buildPipelineStageType: z.literal('TRIGGER_DEPLOYMENT_PIPELINE'),
    definedTags: definedTagsSchema.optional(),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    deployPipelineId: z.string().max(8192),
    isPassAllParametersEnabled: z.boolean(),
  })
  .strict()

const createAbsoluteWaitCriteriaDetailsSchema = z
  .object({
    waitType: z.literal('ABSOLUTE_WAIT'),
    waitDuration: z.string().max(8192),
  })
  .strict()

const createWaitCriteriaDetailsSchema = createAbsoluteWaitCriteriaDetailsSchema

const createWaitStageDetailsSchema = z
  .object({
    buildPipelineId: z.string().min(1).max(255),
    buildPipelineStagePredecessorCollection: buildPipelineStagePredecessorCollectionSchema,
    buildPipelineStageType: z.literal('WAIT'),
    definedTags: definedTagsSchema.optional(),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    waitCriteria: createWaitCriteriaDetailsSchema,
  })
  .strict()

const buildRunArgumentSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[a-zA-Z][a-zA-Z_0-9]*$/),
    value: z.string().min(1).max(1024),
  })
  .strict()

const buildRunArgumentCollectionSchema = z
  .object({
    items: z.array(buildRunArgumentSchema).max(100),
  })
  .strict()

const commitInfoSchema = z
  .object({
    commitHash: z.string().min(1).max(255),
    repositoryBranch: z.string().min(1).max(255),
    repositoryUrl: z.string().min(1).max(255),
  })
  .strict()

const caCertVerifySchema = z
  .object({
    tlsVerifyMode: z.literal('CA_CERTIFICATE_VERIFY'),
    caCertificateBundleId: z.string().min(1).max(255),
  })
  .strict()

const tlsVerifyConfigSchema = caCertVerifySchema

const createBitbucketServerAccessTokenConnectionDetailsSchema = z
  .object({
    connectionType: z.literal('BITBUCKET_SERVER_ACCESS_TOKEN'),
    definedTags: definedTagsSchema.optional(),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    projectId: z.string().min(1).max(255),
    secretId: z
      .string()
      .min(1)
      .max(255)
      .regex(/^ocid1\.vaultsecret\.[a-z0-9.-]+$/),
    baseUrl: z.string().min(1).max(512),
    tlsVerifyConfig: tlsVerifyConfigSchema.optional(),
  })
  .strict()

const createGithubAccessTokenConnectionDetailsSchema = z
  .object({
    connectionType: z.literal('GITHUB_ACCESS_TOKEN'),
    definedTags: definedTagsSchema.optional(),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    projectId: z.string().min(1).max(255),
    secretId: z
      .string()
      .min(1)
      .max(255)
      .regex(/^ocid1\.vaultsecret\.[a-z0-9.-]+$/),
  })
  .strict()

const createGitlabAccessTokenConnectionDetailsSchema = z
  .object({
    connectionType: z.literal('GITLAB_ACCESS_TOKEN'),
    definedTags: definedTagsSchema.optional(),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    projectId: z.string().min(1).max(255),
    secretId: z
      .string()
      .min(1)
      .max(255)
      .regex(/^ocid1\.vaultsecret\.[a-z0-9.-]+$/),
  })
  .strict()

const createGitlabServerAccessTokenConnectionDetailsSchema = z
  .object({
    connectionType: z.literal('GITLAB_SERVER_ACCESS_TOKEN'),
    definedTags: definedTagsSchema.optional(),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    projectId: z.string().min(1).max(255),
    secretId: z
      .string()
      .min(1)
      .max(255)
      .regex(/^ocid1\.vaultsecret\.[a-z0-9.-]+$/),
    baseUrl: z.string().min(1).max(512),
    tlsVerifyConfig: tlsVerifyConfigSchema.optional(),
  })
  .strict()

const createVbsAccessTokenConnectionDetailsSchema = z
  .object({
    connectionType: z.literal('VBS_ACCESS_TOKEN'),
    definedTags: definedTagsSchema.optional(),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    projectId: z.string().min(1).max(255),
    secretId: z
      .string()
      .min(1)
      .max(255)
      .regex(/^ocid1\.vaultsecret\.[a-z0-9.-]+$/),
    baseUrl: z.string().min(1).max(512),
  })
  .strict()

const genericDeployArtifactSourceSchema = z
  .object({
    deployArtifactSourceType: z.literal('GENERIC_ARTIFACT'),
    deployArtifactPath: z.string().min(1).max(1024),
    deployArtifactVersion: z.string().min(1).max(255),
    repositoryId: z.string().min(1).max(255),
  })
  .strict()

const helmCommandSpecArtifactSourceSchema = z
  .object({
    deployArtifactSourceType: z.literal('HELM_COMMAND_SPEC'),
    base64EncodedContent: z.string().min(1).max(10240),
    helmArtifactSourceType: z.literal('INLINE'),
  })
  .strict()

const helmRepositoryDeployArtifactSourceSchema = z
  .object({
    deployArtifactSourceType: z.literal('HELM_CHART'),
    chartUrl: z.string().min(1).max(1024),
    deployArtifactVersion: z.string().min(1).max(255),
  })
  .strict()

const inlineDeployArtifactSourceSchema = z
  .object({
    deployArtifactSourceType: z.literal('INLINE'),
    base64EncodedContent: z.string().min(1).max(10240),
  })
  .strict()

const ocirDeployArtifactSourceSchema = z
  .object({
    deployArtifactSourceType: z.literal('OCIR'),
    imageDigest: z.string().max(1024).optional(),
    imageUri: z.string().min(1).max(1024),
  })
  .strict()

const deployArtifactSourceSchema = z.discriminatedUnion('deployArtifactSourceType', [
  genericDeployArtifactSourceSchema,
  helmCommandSpecArtifactSourceSchema,
  helmRepositoryDeployArtifactSourceSchema,
  inlineDeployArtifactSourceSchema,
  ocirDeployArtifactSourceSchema,
])

const createDeployArtifactDetailsSchema = z
  .object({
    argumentSubstitutionMode: z.enum(['NONE', 'SUBSTITUTE_PLACEHOLDERS']),
    definedTags: definedTagsSchema.optional(),
    deployArtifactSource: deployArtifactSourceSchema,
    deployArtifactType: z.enum([
      'DEPLOYMENT_SPEC',
      'JOB_SPEC',
      'KUBERNETES_MANIFEST',
      'GENERIC_FILE',
      'DOCKER_IMAGE',
      'HELM_CHART',
      'HELM_COMMAND_SPEC',
      'COMMAND_SPEC',
    ]),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    projectId: z.string().min(1).max(255),
  })
  .strict()

const computeInstanceGroupByIdsSelectorSchema = z
  .object({
    selectorType: z.literal('INSTANCE_IDS'),
    computeInstanceIds: z.array(z.string().max(8192)).max(100),
  })
  .strict()

const computeInstanceGroupByQuerySelectorSchema = z
  .object({
    selectorType: z.literal('INSTANCE_QUERY'),
    query: z.string().max(1024),
    region: z.string().min(1).max(255),
  })
  .strict()

const computeInstanceGroupSelectorSchema = z.discriminatedUnion('selectorType', [
  computeInstanceGroupByIdsSelectorSchema,
  computeInstanceGroupByQuerySelectorSchema,
])

const computeInstanceGroupSelectorCollectionSchema = z
  .object({
    items: z.array(computeInstanceGroupSelectorSchema).max(100),
  })
  .strict()

const createComputeInstanceGroupDeployEnvironmentDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployEnvironmentType: z.literal('COMPUTE_INSTANCE_GROUP'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    projectId: z.string().min(1).max(255),
    computeInstanceGroupSelectors: computeInstanceGroupSelectorCollectionSchema,
  })
  .strict()

const createFunctionDeployEnvironmentDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployEnvironmentType: z.literal('FUNCTION'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    projectId: z.string().min(1).max(255),
    functionId: z.string().min(1).max(255),
  })
  .strict()

const createOkeClusterDeployEnvironmentDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployEnvironmentType: z.literal('OKE_CLUSTER'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    projectId: z.string().min(1).max(255),
    clusterId: z.string().min(1).max(255),
    networkChannel: networkChannelSchema.optional(),
  })
  .strict()

const deployPipelineParameterSchema = z
  .object({
    defaultValue: z.string().min(1).max(512).optional(),
    description: z.string().min(1).max(400).optional(),
    name: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[a-zA-Z][a-zA-Z_0-9]*$/),
  })
  .strict()

const deployPipelineParameterCollectionSchema = z
  .object({
    items: z.array(deployPipelineParameterSchema).max(100),
  })
  .strict()

const deployStagePredecessorSchema = z
  .object({
    id: z.string().max(8192),
  })
  .strict()

const deployStagePredecessorCollectionSchema = z
  .object({
    items: z.array(deployStagePredecessorSchema).max(100),
  })
  .strict()

const computeInstanceGroupFailurePolicyByCountSchema = z
  .object({
    policyType: z.literal('COMPUTE_INSTANCE_GROUP_FAILURE_POLICY_BY_COUNT'),
    failureCount: z.number().int().min(1),
  })
  .strict()

const computeInstanceGroupFailurePolicyByPercentageSchema = z
  .object({
    policyType: z.literal('COMPUTE_INSTANCE_GROUP_FAILURE_POLICY_BY_PERCENTAGE'),
    failurePercentage: z.number().int().min(1).max(100),
  })
  .strict()

const computeInstanceGroupFailurePolicySchema = z.discriminatedUnion('policyType', [
  computeInstanceGroupFailurePolicyByCountSchema,
  computeInstanceGroupFailurePolicyByPercentageSchema,
])

const loadBalancerConfigSchema = z
  .object({
    backendPort: z.number().int().min(1).max(65535).optional(),
    listenerName: z.string().min(1).max(400),
    loadBalancerId: z.string().min(1).max(255),
  })
  .strict()

const computeInstanceGroupLinearRolloutPolicyByCountSchema = z
  .object({
    batchDelayInSeconds: z.number().int().min(0).max(3600).optional(),
    policyType: z.literal('COMPUTE_INSTANCE_GROUP_LINEAR_ROLLOUT_POLICY_BY_COUNT'),
    batchCount: z.number().int().min(1),
  })
  .strict()

const computeInstanceGroupLinearRolloutPolicyByPercentageSchema = z
  .object({
    batchDelayInSeconds: z.number().int().min(0).max(3600).optional(),
    policyType: z.literal('COMPUTE_INSTANCE_GROUP_LINEAR_ROLLOUT_POLICY_BY_PERCENTAGE'),
    batchPercentage: z.number().int().min(1),
  })
  .strict()

const computeInstanceGroupRolloutPolicySchema = z.discriminatedUnion('policyType', [
  computeInstanceGroupLinearRolloutPolicyByCountSchema,
  computeInstanceGroupLinearRolloutPolicyByPercentageSchema,
])

const createComputeInstanceGroupBlueGreenDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployPipelineId: z.string().min(1).max(255),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema,
    deployStageType: z.literal('COMPUTE_INSTANCE_GROUP_BLUE_GREEN_DEPLOYMENT'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    deployArtifactIds: z.array(z.string().max(8192)).max(100).optional(),
    deployEnvironmentIdA: z.string().min(1).max(255),
    deployEnvironmentIdB: z.string().min(1).max(255),
    deploymentSpecDeployArtifactId: z.string().min(1).max(255),
    failurePolicy: computeInstanceGroupFailurePolicySchema.optional(),
    productionLoadBalancerConfig: loadBalancerConfigSchema,
    rolloutPolicy: computeInstanceGroupRolloutPolicySchema,
    testLoadBalancerConfig: loadBalancerConfigSchema.optional(),
  })
  .strict()

const createComputeInstanceGroupBlueGreenTrafficShiftDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployPipelineId: z.string().min(1).max(255),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema,
    deployStageType: z.literal('COMPUTE_INSTANCE_GROUP_BLUE_GREEN_TRAFFIC_SHIFT'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    computeInstanceGroupBlueGreenDeploymentDeployStageId: z.string().min(1).max(255),
  })
  .strict()

const countBasedApprovalPolicySchema = z
  .object({
    approvalPolicyType: z.literal('COUNT_BASED_APPROVAL'),
    numberOfApprovalsRequired: z.number().int().min(1).max(5),
  })
  .strict()

const approvalPolicySchema = countBasedApprovalPolicySchema

const createComputeInstanceGroupCanaryApprovalDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployPipelineId: z.string().min(1).max(255),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema,
    deployStageType: z.literal('COMPUTE_INSTANCE_GROUP_CANARY_APPROVAL'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    approvalPolicy: approvalPolicySchema,
    computeInstanceGroupCanaryTrafficShiftDeployStageId: z.string().max(8192),
  })
  .strict()

const createComputeInstanceGroupCanaryDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployPipelineId: z.string().min(1).max(255),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema,
    deployStageType: z.literal('COMPUTE_INSTANCE_GROUP_CANARY_DEPLOYMENT'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    computeInstanceGroupDeployEnvironmentId: z.string().min(1).max(255),
    deployArtifactIds: z.array(z.string().max(8192)).max(100).optional(),
    deploymentSpecDeployArtifactId: z.string().min(1).max(255),
    productionLoadBalancerConfig: loadBalancerConfigSchema,
    rolloutPolicy: computeInstanceGroupRolloutPolicySchema,
    testLoadBalancerConfig: loadBalancerConfigSchema.optional(),
  })
  .strict()

const loadBalancerTrafficShiftRolloutPolicySchema = z
  .object({
    batchCount: z.number().int(),
    batchDelayInSeconds: z.number().int().min(0).max(3600).optional(),
    rampLimitPercent: z.number().optional(),
  })
  .strict()

const createComputeInstanceGroupCanaryTrafficShiftDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployPipelineId: z.string().min(1).max(255),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema,
    deployStageType: z.literal('COMPUTE_INSTANCE_GROUP_CANARY_TRAFFIC_SHIFT'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    computeInstanceGroupCanaryDeployStageId: z.string().min(1).max(255),
    rolloutPolicy: loadBalancerTrafficShiftRolloutPolicySchema,
  })
  .strict()

const automatedDeployStageRollbackPolicySchema = z
  .object({
    policyType: z.literal('AUTOMATED_STAGE_ROLLBACK_POLICY'),
  })
  .strict()

const noDeployStageRollbackPolicySchema = z
  .object({
    policyType: z.literal('NO_STAGE_ROLLBACK_POLICY'),
  })
  .strict()

const deployStageRollbackPolicySchema = z.discriminatedUnion('policyType', [
  automatedDeployStageRollbackPolicySchema,
  noDeployStageRollbackPolicySchema,
])

const createComputeInstanceGroupDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployPipelineId: z.string().min(1).max(255),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema,
    deployStageType: z.literal('COMPUTE_INSTANCE_GROUP_ROLLING_DEPLOYMENT'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    computeInstanceGroupDeployEnvironmentId: z.string().min(1).max(255),
    deployArtifactIds: z.array(z.string().max(8192)).max(100).optional(),
    deploymentSpecDeployArtifactId: z.string().min(1).max(255),
    failurePolicy: computeInstanceGroupFailurePolicySchema.optional(),
    loadBalancerConfig: loadBalancerConfigSchema.optional(),
    rollbackPolicy: deployStageRollbackPolicySchema.optional(),
    rolloutPolicy: computeInstanceGroupRolloutPolicySchema,
  })
  .strict()

const createFunctionDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployPipelineId: z.string().min(1).max(255),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema,
    deployStageType: z.literal('DEPLOY_FUNCTION'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    config: z.record(z.string().max(255), z.string().max(8192)).optional(),
    dockerImageDeployArtifactId: z.string().min(1).max(255),
    functionDeployEnvironmentId: z.string().min(1).max(255),
    functionTimeoutInSeconds: z.number().int().optional(),
    maxMemoryInMBs: z.number().int().optional(),
  })
  .strict()

const createInvokeFunctionDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployPipelineId: z.string().min(1).max(255),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema,
    deployStageType: z.literal('INVOKE_FUNCTION'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    deployArtifactId: z.string().min(1).max(255).optional(),
    functionDeployEnvironmentId: z.string().min(1).max(255),
    isAsync: z.boolean(),
    isValidationEnabled: z.boolean(),
  })
  .strict()

const backendSetIpCollectionSchema = z
  .object({
    items: z.array(z.string().max(8192)).max(100).optional(),
  })
  .strict()

const createLoadBalancerTrafficShiftDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployPipelineId: z.string().min(1).max(255),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema,
    deployStageType: z.literal('LOAD_BALANCER_TRAFFIC_SHIFT'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    blueBackendIps: backendSetIpCollectionSchema,
    greenBackendIps: backendSetIpCollectionSchema,
    loadBalancerConfig: loadBalancerConfigSchema,
    rollbackPolicy: deployStageRollbackPolicySchema.optional(),
    rolloutPolicy: loadBalancerTrafficShiftRolloutPolicySchema,
    trafficShiftTarget: z.enum(['AUTO_SELECT', 'BLUE', 'GREEN']),
  })
  .strict()

const createManualApprovalDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployPipelineId: z.string().min(1).max(255),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema,
    deployStageType: z.literal('MANUAL_APPROVAL'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    approvalPolicy: approvalPolicySchema,
  })
  .strict()

const nginxBlueGreenStrategySchema = z
  .object({
    strategyType: z.literal('NGINX_BLUE_GREEN_STRATEGY'),
    ingressName: z.string().min(1).max(63),
    namespaceA: z.string().min(1).max(63),
    namespaceB: z.string().min(1).max(63),
  })
  .strict()

const okeBlueGreenStrategySchema = nginxBlueGreenStrategySchema

const createOkeBlueGreenDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployPipelineId: z.string().min(1).max(255),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema,
    deployStageType: z.literal('OKE_BLUE_GREEN_DEPLOYMENT'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    blueGreenStrategy: okeBlueGreenStrategySchema,
    kubernetesManifestDeployArtifactIds: z.array(z.string().max(8192)).max(100),
    okeClusterDeployEnvironmentId: z.string().min(1).max(255),
  })
  .strict()

const createOkeBlueGreenTrafficShiftDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployPipelineId: z.string().min(1).max(255),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema,
    deployStageType: z.literal('OKE_BLUE_GREEN_TRAFFIC_SHIFT'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    okeBlueGreenDeployStageId: z.string().min(1).max(255),
  })
  .strict()

const createOkeCanaryApprovalDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployPipelineId: z.string().min(1).max(255),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema,
    deployStageType: z.literal('OKE_CANARY_APPROVAL'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    approvalPolicy: approvalPolicySchema,
    okeCanaryTrafficShiftDeployStageId: z.string().min(1).max(255),
  })
  .strict()

const nginxCanaryStrategySchema = z
  .object({
    strategyType: z.literal('NGINX_CANARY_STRATEGY'),
    ingressName: z.string().min(1).max(63),
    namespace: z.string().min(1).max(63),
  })
  .strict()

const okeCanaryStrategySchema = nginxCanaryStrategySchema

const createOkeCanaryDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployPipelineId: z.string().min(1).max(255),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema,
    deployStageType: z.literal('OKE_CANARY_DEPLOYMENT'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    canaryStrategy: okeCanaryStrategySchema,
    kubernetesManifestDeployArtifactIds: z.array(z.string().min(1).max(255)).max(100),
    okeClusterDeployEnvironmentId: z.string().min(1).max(255),
  })
  .strict()

const createOkeCanaryTrafficShiftDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployPipelineId: z.string().min(1).max(255),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema,
    deployStageType: z.literal('OKE_CANARY_TRAFFIC_SHIFT'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    okeCanaryDeployStageId: z.string().min(1).max(255),
    rolloutPolicy: loadBalancerTrafficShiftRolloutPolicySchema,
  })
  .strict()

const createOkeDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployPipelineId: z.string().min(1).max(255),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema,
    deployStageType: z.literal('OKE_DEPLOYMENT'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    kubernetesManifestDeployArtifactIds: z.array(z.string().max(8192)).max(100),
    namespace: z.string().min(1).max(255).optional(),
    okeClusterDeployEnvironmentId: z.string().min(1).max(255),
    rollbackPolicy: deployStageRollbackPolicySchema.optional(),
  })
  .strict()

const createOkeHelmChartDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployPipelineId: z.string().min(1).max(255),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema,
    deployStageType: z.literal('OKE_HELM_CHART_DEPLOYMENT'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    helmChartDeployArtifactId: z.string().min(1).max(255),
    helmCommandArtifactIds: z.array(z.string().max(8192)).max(100).optional(),
    isUninstallOnStageDelete: z.boolean().optional(),
    namespace: z.string().min(1).max(255).optional(),
    okeClusterDeployEnvironmentId: z.string().min(1).max(255),
    purpose: z.enum(['EXECUTE_HELM_UPGRADE', 'EXECUTE_HELM_COMMAND']).optional(),
    releaseName: z.string().min(1).max(53),
    rollbackPolicy: deployStageRollbackPolicySchema.optional(),
    timeoutInSeconds: z.number().int().max(3600).optional(),
    valuesArtifactIds: z.array(z.string().min(1).max(255)).max(5).optional(),
  })
  .strict()

const shapeConfigSchema = z
  .object({
    memoryInGBs: z.number().min(1.0).optional(),
    ocpus: z.number().min(1.0),
  })
  .strict()

const containerInstanceConfigSchema = z
  .object({
    containerConfigType: z.literal('CONTAINER_INSTANCE_CONFIG'),
    availabilityDomain: z.string().max(8192).optional(),
    compartmentId: z.string().min(1).max(255).optional(),
    networkChannel: networkChannelSchema,
    shapeConfig: shapeConfigSchema,
    shapeName: z.string().max(8192),
  })
  .strict()

const containerConfigSchema = containerInstanceConfigSchema

const createShellDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployPipelineId: z.string().min(1).max(255),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema,
    deployStageType: z.literal('SHELL'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    commandSpecDeployArtifactId: z.string().min(1).max(255),
    containerConfig: containerConfigSchema,
    timeoutInSeconds: z.number().int().optional(),
  })
  .strict()

const absoluteWaitCriteriaSchema = z
  .object({
    waitType: z.literal('ABSOLUTE_WAIT'),
    waitDuration: z.string().min(1).max(255),
  })
  .strict()

const waitCriteriaSchema = absoluteWaitCriteriaSchema

const createWaitDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployPipelineId: z.string().min(1).max(255),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema,
    deployStageType: z.literal('WAIT'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    waitCriteria: waitCriteriaSchema,
  })
  .strict()

const deployArtifactOverrideArgumentSchema = z
  .object({
    deployArtifactId: z.string().max(8192),
    name: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[a-zA-Z][a-zA-Z_0-9]*$/),
    value: z.string().min(1).max(255),
  })
  .strict()

const deployArtifactOverrideArgumentCollectionSchema = z
  .object({
    items: z.array(deployArtifactOverrideArgumentSchema).max(100),
  })
  .strict()

const deployStageOverrideArgumentSchema = z
  .object({
    deployStageId: z.string().min(1).max(255),
    name: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[a-zA-Z][a-zA-Z_0-9]*$/),
    value: z.string().min(1).max(255),
  })
  .strict()

const deployStageOverrideArgumentCollectionSchema = z
  .object({
    items: z.array(deployStageOverrideArgumentSchema).max(100),
  })
  .strict()

const deploymentArgumentSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[a-zA-Z][a-zA-Z_0-9]*$/),
    value: z.string().min(1).max(255),
  })
  .strict()

const deploymentArgumentCollectionSchema = z
  .object({
    items: z.array(deploymentArgumentSchema).max(100),
  })
  .strict()

const createDeployPipelineDeploymentDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployPipelineId: z.string().min(1).max(255),
    deploymentType: z.literal('PIPELINE_DEPLOYMENT'),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    deployArtifactOverrideArguments: deployArtifactOverrideArgumentCollectionSchema.optional(),
    deployStageOverrideArguments: deployStageOverrideArgumentCollectionSchema.optional(),
    deploymentArguments: deploymentArgumentCollectionSchema.optional(),
  })
  .strict()

const createDeployPipelineRedeploymentDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployPipelineId: z.string().min(1).max(255),
    deploymentType: z.literal('PIPELINE_REDEPLOYMENT'),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    previousDeploymentId: z.string().min(1).max(255),
  })
  .strict()

const createSingleDeployStageDeploymentDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployPipelineId: z.string().min(1).max(255),
    deploymentType: z.literal('SINGLE_STAGE_DEPLOYMENT'),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    deployArtifactOverrideArguments: deployArtifactOverrideArgumentCollectionSchema.optional(),
    deployStageId: z.string().min(1).max(255),
    deployStageOverrideArguments: deployStageOverrideArgumentCollectionSchema.optional(),
    deploymentArguments: deploymentArgumentCollectionSchema.optional(),
  })
  .strict()

const createSingleDeployStageRedeploymentDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployPipelineId: z.string().min(1).max(255),
    deploymentType: z.literal('SINGLE_STAGE_REDEPLOYMENT'),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    deployStageId: z.string().min(1).max(255),
    previousDeploymentId: z.string().min(1).max(255).optional(),
  })
  .strict()

const notificationConfigSchema = z
  .object({
    topicId: z.string().min(1).max(255),
  })
  .strict()

const triggerScheduleSchema = z
  .object({
    customSchedule: z.string().max(400).optional(),
    scheduleType: z.enum(['NONE', 'DEFAULT', 'CUSTOM']),
  })
  .strict()

const mirrorRepositoryConfigSchema = z
  .object({
    connectorId: z.string().max(8192).optional(),
    repositoryUrl: z.string().max(8192).optional(),
    triggerSchedule: triggerScheduleSchema.optional(),
  })
  .strict()

const fileFilterSchema = z
  .object({
    filePaths: z.array(z.string().min(1).max(512)).min(1).max(10).optional(),
  })
  .strict()

const bitbucketCloudFilterExclusionAttributesSchema = z
  .object({
    fileFilter: fileFilterSchema.optional(),
  })
  .strict()

const bitbucketCloudFilterAttributesSchema = z
  .object({
    baseRef: z.string().max(255).optional(),
    fileFilter: fileFilterSchema.optional(),
    headRef: z.string().max(255).optional(),
  })
  .strict()

const bitbucketCloudFilterSchema = z
  .object({
    triggerSource: z.literal('BITBUCKET_CLOUD'),
    events: z
      .array(
        z.enum(['PUSH', 'PULL_REQUEST_CREATED', 'PULL_REQUEST_UPDATED', 'PULL_REQUEST_MERGED'])
      )
      .max(100)
      .optional(),
    exclude: bitbucketCloudFilterExclusionAttributesSchema.optional(),
    include: bitbucketCloudFilterAttributesSchema.optional(),
  })
  .strict()

const bitbucketServerFilterAttributesSchema = z
  .object({
    baseRef: z.string().max(255).optional(),
    headRef: z.string().max(255).optional(),
  })
  .strict()

const bitbucketServerFilterSchema = z
  .object({
    triggerSource: z.literal('BITBUCKET_SERVER'),
    events: z
      .array(
        z.enum(['PUSH', 'PULL_REQUEST_OPENED', 'PULL_REQUEST_MODIFIED', 'PULL_REQUEST_MERGED'])
      )
      .min(1)
      .max(4)
      .optional(),
    include: bitbucketServerFilterAttributesSchema.optional(),
  })
  .strict()

const devopsCodeRepositoryFilterExclusionAttributesSchema = z
  .object({
    fileFilter: fileFilterSchema.optional(),
  })
  .strict()

const devopsCodeRepositoryFilterAttributesSchema = z
  .object({
    baseRef: z.string().max(255).optional(),
    fileFilter: fileFilterSchema.optional(),
    headRef: z.string().max(8192).optional(),
  })
  .strict()

const devopsCodeRepositoryFilterSchema = z
  .object({
    triggerSource: z.literal('DEVOPS_CODE_REPOSITORY'),
    events: z
      .array(z.enum(['PUSH', 'PULL_REQUEST_CREATED', 'PULL_REQUEST_UPDATED']))
      .max(100)
      .optional(),
    exclude: devopsCodeRepositoryFilterExclusionAttributesSchema.optional(),
    include: devopsCodeRepositoryFilterAttributesSchema.optional(),
  })
  .strict()

const githubFilterExclusionAttributesSchema = z
  .object({
    fileFilter: fileFilterSchema.optional(),
  })
  .strict()

const githubFilterAttributesSchema = z
  .object({
    baseRef: z.string().max(8192).optional(),
    fileFilter: fileFilterSchema.optional(),
    headRef: z.string().max(8192).optional(),
  })
  .strict()

const githubFilterSchema = z
  .object({
    triggerSource: z.literal('GITHUB'),
    events: z
      .array(
        z.enum([
          'PUSH',
          'PULL_REQUEST_CREATED',
          'PULL_REQUEST_UPDATED',
          'PULL_REQUEST_REOPENED',
          'PULL_REQUEST_MERGED',
        ])
      )
      .max(100)
      .optional(),
    exclude: githubFilterExclusionAttributesSchema.optional(),
    include: githubFilterAttributesSchema.optional(),
  })
  .strict()

const gitlabFilterExclusionAttributesSchema = z
  .object({
    fileFilter: fileFilterSchema.optional(),
  })
  .strict()

const gitlabFilterAttributesSchema = z
  .object({
    baseRef: z.string().max(8192).optional(),
    fileFilter: fileFilterSchema.optional(),
    headRef: z.string().max(8192).optional(),
  })
  .strict()

const gitlabFilterSchema = z
  .object({
    triggerSource: z.literal('GITLAB'),
    events: z
      .array(
        z.enum([
          'PUSH',
          'PULL_REQUEST_CREATED',
          'PULL_REQUEST_UPDATED',
          'PULL_REQUEST_REOPENED',
          'PULL_REQUEST_MERGED',
        ])
      )
      .max(100)
      .optional(),
    exclude: gitlabFilterExclusionAttributesSchema.optional(),
    include: gitlabFilterAttributesSchema.optional(),
  })
  .strict()

const gitlabServerFilterExclusionAttributesSchema = z
  .object({
    fileFilter: fileFilterSchema.optional(),
  })
  .strict()

const gitlabServerFilterAttributesSchema = z
  .object({
    baseRef: z.string().max(255).optional(),
    fileFilter: fileFilterSchema.optional(),
    headRef: z.string().max(255).optional(),
  })
  .strict()

const gitlabServerFilterSchema = z
  .object({
    triggerSource: z.literal('GITLAB_SERVER'),
    events: z
      .array(
        z.enum([
          'PUSH',
          'PULL_REQUEST_CREATED',
          'PULL_REQUEST_UPDATED',
          'PULL_REQUEST_REOPENED',
          'PULL_REQUEST_MERGED',
        ])
      )
      .max(100)
      .optional(),
    exclude: gitlabServerFilterExclusionAttributesSchema.optional(),
    include: gitlabServerFilterAttributesSchema.optional(),
  })
  .strict()

const vbsFilterExclusionAttributesSchema = z
  .object({
    fileFilter: fileFilterSchema.optional(),
  })
  .strict()

const vbsFilterAttributesSchema = z
  .object({
    baseRef: z.string().max(255).optional(),
    fileFilter: fileFilterSchema.optional(),
    headRef: z.string().max(255).optional(),
    repositoryName: z.string().max(255).optional(),
  })
  .strict()

const vbsFilterSchema = z
  .object({
    triggerSource: z.literal('VBS'),
    events: z
      .array(
        z.enum(['PUSH', 'MERGE_REQUEST_CREATED', 'MERGE_REQUEST_UPDATED', 'MERGE_REQUEST_MERGED'])
      )
      .min(0)
      .max(4)
      .optional(),
    exclude: vbsFilterExclusionAttributesSchema.optional(),
    include: vbsFilterAttributesSchema.optional(),
  })
  .strict()

const filterSchema = z.discriminatedUnion('triggerSource', [
  bitbucketCloudFilterSchema,
  bitbucketServerFilterSchema,
  devopsCodeRepositoryFilterSchema,
  githubFilterSchema,
  gitlabFilterSchema,
  gitlabServerFilterSchema,
  vbsFilterSchema,
])

const triggerBuildPipelineActionSchema = z
  .object({
    filter: filterSchema.optional(),
    type: z.literal('TRIGGER_BUILD_PIPELINE'),
    buildPipelineId: z.string().max(8192),
  })
  .strict()

const triggerActionSchema = triggerBuildPipelineActionSchema

const createDevopsCodeRepositoryTriggerDetailsSchema = z
  .object({
    actions: z
      .array(triggerActionSchema.extend({ filter: devopsCodeRepositoryFilterSchema.optional() }))
      .max(20),
    definedTags: definedTagsSchema.optional(),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    projectId: z.string().min(1).max(255),
    triggerSource: z.literal('DEVOPS_CODE_REPOSITORY'),
    repositoryId: z.string().max(8192).optional(),
  })
  .strict()

const updateBuildStageDetailsSchema = z
  .object({
    buildPipelineStagePredecessorCollection:
      buildPipelineStagePredecessorCollectionSchema.optional(),
    buildPipelineStageType: z.literal('BUILD'),
    definedTags: definedTagsSchema.optional(),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    buildRunnerShapeConfig: buildRunnerShapeConfigSchema.optional(),
    buildSourceCollection: buildSourceCollectionSchema.optional(),
    buildSpecFile: z.string().max(8192).optional(),
    image: z.literal('OL7_X86_64_STANDARD_10').optional(),
    primaryBuildSource: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[a-zA-Z_]{1,}[a-zA-Z0-9_-]{0,}$/)
      .optional(),
    privateAccessConfig: networkChannelSchema.optional(),
    stageExecutionTimeoutInSeconds: z.number().int().optional(),
  })
  .strict()

const updateDeliverArtifactStageDetailsSchema = z
  .object({
    buildPipelineStagePredecessorCollection:
      buildPipelineStagePredecessorCollectionSchema.optional(),
    buildPipelineStageType: z.literal('DELIVER_ARTIFACT'),
    definedTags: definedTagsSchema.optional(),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    deliverArtifactCollection: deliverArtifactCollectionSchema.optional(),
  })
  .strict()

const updateTriggerDeploymentStageDetailsSchema = z
  .object({
    buildPipelineStagePredecessorCollection:
      buildPipelineStagePredecessorCollectionSchema.optional(),
    buildPipelineStageType: z.literal('TRIGGER_DEPLOYMENT_PIPELINE'),
    definedTags: definedTagsSchema.optional(),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    deployPipelineId: z.string().max(8192).optional(),
    isPassAllParametersEnabled: z.boolean().optional(),
  })
  .strict()

const updateAbsoluteWaitCriteriaDetailsSchema = z
  .object({
    waitType: z.literal('ABSOLUTE_WAIT'),
    waitDuration: z.string().max(8192).optional(),
  })
  .strict()

const updateWaitCriteriaDetailsSchema = updateAbsoluteWaitCriteriaDetailsSchema

const updateWaitStageDetailsSchema = z
  .object({
    buildPipelineStagePredecessorCollection:
      buildPipelineStagePredecessorCollectionSchema.optional(),
    buildPipelineStageType: z.literal('WAIT'),
    definedTags: definedTagsSchema.optional(),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    waitCriteria: updateWaitCriteriaDetailsSchema.optional(),
  })
  .strict()

const updateBitbucketServerAccessTokenConnectionDetailsSchema = z
  .object({
    connectionType: z.literal('BITBUCKET_SERVER_ACCESS_TOKEN'),
    definedTags: definedTagsSchema.optional(),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    secretId: z
      .string()
      .min(1)
      .max(255)
      .regex(/^ocid1\.vaultsecret\.[a-z0-9.-]+$/)
      .optional(),
    baseUrl: z.string().min(1).max(512).optional(),
    tlsVerifyConfig: tlsVerifyConfigSchema.optional(),
  })
  .strict()

const updateGithubAccessTokenConnectionDetailsSchema = z
  .object({
    connectionType: z.literal('GITHUB_ACCESS_TOKEN'),
    definedTags: definedTagsSchema.optional(),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    secretId: z
      .string()
      .min(1)
      .max(255)
      .regex(/^ocid1\.vaultsecret\.[a-z0-9.-]+$/)
      .optional(),
  })
  .strict()

const updateGitlabAccessTokenConnectionDetailsSchema = z
  .object({
    connectionType: z.literal('GITLAB_ACCESS_TOKEN'),
    definedTags: definedTagsSchema.optional(),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    secretId: z
      .string()
      .min(1)
      .max(255)
      .regex(/^ocid1\.vaultsecret\.[a-z0-9.-]+$/)
      .optional(),
  })
  .strict()

const updateGitlabServerAccessTokenConnectionDetailsSchema = z
  .object({
    connectionType: z.literal('GITLAB_SERVER_ACCESS_TOKEN'),
    definedTags: definedTagsSchema.optional(),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    secretId: z
      .string()
      .min(1)
      .max(255)
      .regex(/^ocid1\.vaultsecret\.[a-z0-9.-]+$/)
      .optional(),
    baseUrl: z.string().min(1).max(512).optional(),
    tlsVerifyConfig: tlsVerifyConfigSchema.optional(),
  })
  .strict()

const updateVbsAccessTokenConnectionDetailsSchema = z
  .object({
    connectionType: z.literal('VBS_ACCESS_TOKEN'),
    definedTags: definedTagsSchema.optional(),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    secretId: z
      .string()
      .min(1)
      .max(255)
      .regex(/^ocid1\.vaultsecret\.[a-z0-9.-]+$/)
      .optional(),
    baseUrl: z.string().min(1).max(255).optional(),
  })
  .strict()

const updateDeployArtifactDetailsSchema = z
  .object({
    argumentSubstitutionMode: z.enum(['NONE', 'SUBSTITUTE_PLACEHOLDERS']).optional(),
    definedTags: definedTagsSchema.optional(),
    deployArtifactSource: deployArtifactSourceSchema.optional(),
    deployArtifactType: z
      .enum([
        'DEPLOYMENT_SPEC',
        'JOB_SPEC',
        'KUBERNETES_MANIFEST',
        'GENERIC_FILE',
        'DOCKER_IMAGE',
        'HELM_CHART',
        'HELM_COMMAND_SPEC',
        'COMMAND_SPEC',
      ])
      .optional(),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
  })
  .strict()

const updateComputeInstanceGroupDeployEnvironmentDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployEnvironmentType: z.literal('COMPUTE_INSTANCE_GROUP'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    computeInstanceGroupSelectors: computeInstanceGroupSelectorCollectionSchema.optional(),
  })
  .strict()

const updateFunctionDeployEnvironmentDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployEnvironmentType: z.literal('FUNCTION'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    functionId: z.string().min(1).max(255).optional(),
  })
  .strict()

const updateOkeClusterDeployEnvironmentDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployEnvironmentType: z.literal('OKE_CLUSTER'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    clusterId: z.string().min(1).max(255).optional(),
    networkChannel: networkChannelSchema.optional(),
  })
  .strict()

const updateComputeInstanceGroupBlueGreenDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema.optional(),
    deployStageType: z.literal('COMPUTE_INSTANCE_GROUP_BLUE_GREEN_DEPLOYMENT'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    deployArtifactIds: z.array(z.string().max(8192)).max(100).optional(),
    deploymentSpecDeployArtifactId: z.string().min(1).max(255).optional(),
    failurePolicy: computeInstanceGroupFailurePolicySchema.optional(),
    rolloutPolicy: computeInstanceGroupRolloutPolicySchema.optional(),
    testLoadBalancerConfig: loadBalancerConfigSchema.optional(),
  })
  .strict()

const updateComputeInstanceGroupBlueGreenTrafficShiftDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema.optional(),
    deployStageType: z.literal('COMPUTE_INSTANCE_GROUP_BLUE_GREEN_TRAFFIC_SHIFT'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
  })
  .strict()

const updateComputeInstanceGroupCanaryApprovalDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema.optional(),
    deployStageType: z.literal('COMPUTE_INSTANCE_GROUP_CANARY_APPROVAL'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    approvalPolicy: approvalPolicySchema.optional(),
  })
  .strict()

const updateComputeInstanceGroupCanaryDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema.optional(),
    deployStageType: z.literal('COMPUTE_INSTANCE_GROUP_CANARY_DEPLOYMENT'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    deployArtifactIds: z.array(z.string().max(8192)).max(100).optional(),
    deploymentSpecDeployArtifactId: z.string().min(1).max(255).optional(),
    rolloutPolicy: computeInstanceGroupRolloutPolicySchema.optional(),
    testLoadBalancerConfig: loadBalancerConfigSchema.optional(),
  })
  .strict()

const updateComputeInstanceGroupCanaryTrafficShiftDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema.optional(),
    deployStageType: z.literal('COMPUTE_INSTANCE_GROUP_CANARY_TRAFFIC_SHIFT'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    rolloutPolicy: loadBalancerTrafficShiftRolloutPolicySchema.optional(),
  })
  .strict()

const updateComputeInstanceGroupDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema.optional(),
    deployStageType: z.literal('COMPUTE_INSTANCE_GROUP_ROLLING_DEPLOYMENT'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    computeInstanceGroupDeployEnvironmentId: z.string().min(1).max(255).optional(),
    deployArtifactIds: z.array(z.string().max(8192)).max(100).optional(),
    deploymentSpecDeployArtifactId: z.string().min(1).max(255).optional(),
    failurePolicy: computeInstanceGroupFailurePolicySchema.optional(),
    loadBalancerConfig: loadBalancerConfigSchema.optional(),
    rollbackPolicy: deployStageRollbackPolicySchema.optional(),
    rolloutPolicy: computeInstanceGroupRolloutPolicySchema.optional(),
  })
  .strict()

const updateFunctionDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema.optional(),
    deployStageType: z.literal('DEPLOY_FUNCTION'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    config: z.record(z.string().max(255), z.string().max(8192)).optional(),
    dockerImageDeployArtifactId: z.string().min(1).max(255).optional(),
    functionDeployEnvironmentId: z.string().min(1).max(255).optional(),
    functionTimeoutInSeconds: z.number().int().optional(),
    maxMemoryInMBs: z.number().int().optional(),
  })
  .strict()

const updateInvokeFunctionDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema.optional(),
    deployStageType: z.literal('INVOKE_FUNCTION'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    deployArtifactId: z.string().min(1).max(255).optional(),
    functionDeployEnvironmentId: z.string().min(1).max(255).optional(),
    isAsync: z.boolean().optional(),
    isValidationEnabled: z.boolean().optional(),
  })
  .strict()

const updateLoadBalancerTrafficShiftDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema.optional(),
    deployStageType: z.literal('LOAD_BALANCER_TRAFFIC_SHIFT'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    blueBackendIps: backendSetIpCollectionSchema.optional(),
    greenBackendIps: backendSetIpCollectionSchema.optional(),
    loadBalancerConfig: loadBalancerConfigSchema.optional(),
    rollbackPolicy: deployStageRollbackPolicySchema.optional(),
    rolloutPolicy: loadBalancerTrafficShiftRolloutPolicySchema.optional(),
    trafficShiftTarget: z.enum(['AUTO_SELECT', 'BLUE', 'GREEN']).optional(),
  })
  .strict()

const updateManualApprovalDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema.optional(),
    deployStageType: z.literal('MANUAL_APPROVAL'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    approvalPolicy: approvalPolicySchema.optional(),
  })
  .strict()

const updateOkeBlueGreenDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema.optional(),
    deployStageType: z.literal('OKE_BLUE_GREEN_DEPLOYMENT'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    kubernetesManifestDeployArtifactIds: z.array(z.string().max(8192)).max(100).optional(),
  })
  .strict()

const updateOkeBlueGreenTrafficShiftDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema.optional(),
    deployStageType: z.literal('OKE_BLUE_GREEN_TRAFFIC_SHIFT'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
  })
  .strict()

const updateOkeCanaryApprovalDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema.optional(),
    deployStageType: z.literal('OKE_CANARY_APPROVAL'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    approvalPolicy: approvalPolicySchema.optional(),
  })
  .strict()

const updateOkeCanaryDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema.optional(),
    deployStageType: z.literal('OKE_CANARY_DEPLOYMENT'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    kubernetesManifestDeployArtifactIds: z.array(z.string().min(1).max(255)).max(100).optional(),
  })
  .strict()

const updateOkeCanaryTrafficShiftDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema.optional(),
    deployStageType: z.literal('OKE_CANARY_TRAFFIC_SHIFT'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    rolloutPolicy: loadBalancerTrafficShiftRolloutPolicySchema.optional(),
  })
  .strict()

const updateOkeDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema.optional(),
    deployStageType: z.literal('OKE_DEPLOYMENT'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    kubernetesManifestDeployArtifactIds: z.array(z.string().max(8192)).max(100).optional(),
    namespace: z.string().min(1).max(255).optional(),
    okeClusterDeployEnvironmentId: z.string().min(1).max(255).optional(),
    rollbackPolicy: deployStageRollbackPolicySchema.optional(),
  })
  .strict()

const updateOkeHelmChartDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema.optional(),
    deployStageType: z.literal('OKE_HELM_CHART_DEPLOYMENT'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    helmChartDeployArtifactId: z.string().min(1).max(255).optional(),
    helmCommandArtifactIds: z.array(z.string().max(8192)).max(100).optional(),
    isUninstallOnStageDelete: z.boolean().optional(),
    namespace: z.string().min(1).max(255).optional(),
    okeClusterDeployEnvironmentId: z.string().min(1).max(255).optional(),
    purpose: z.enum(['EXECUTE_HELM_UPGRADE', 'EXECUTE_HELM_COMMAND']).optional(),
    releaseName: z.string().min(1).max(53).optional(),
    rollbackPolicy: deployStageRollbackPolicySchema.optional(),
    timeoutInSeconds: z.number().int().max(3600).optional(),
    valuesArtifactIds: z.array(z.string().min(1).max(255)).max(5).optional(),
  })
  .strict()

const updateShellDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema.optional(),
    deployStageType: z.literal('SHELL'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    commandSpecDeployArtifactId: z.string().min(1).max(255).optional(),
    containerConfig: containerConfigSchema.optional(),
    timeoutInSeconds: z.number().int().optional(),
  })
  .strict()

const updateWaitDeployStageDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deployStagePredecessorCollection: deployStagePredecessorCollectionSchema.optional(),
    deployStageType: z.literal('WAIT'),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    waitCriteria: waitCriteriaSchema.optional(),
  })
  .strict()

const updateDeployPipelineDeploymentDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deploymentType: z.literal('PIPELINE_DEPLOYMENT'),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
  })
  .strict()

const updateDeployPipelineRedeploymentDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deploymentType: z.literal('PIPELINE_REDEPLOYMENT'),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
  })
  .strict()

const updateSingleDeployStageDeploymentDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deploymentType: z.literal('SINGLE_STAGE_DEPLOYMENT'),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
  })
  .strict()

const updateSingleDeployStageRedeploymentDetailsSchema = z
  .object({
    definedTags: definedTagsSchema.optional(),
    deploymentType: z.literal('SINGLE_STAGE_REDEPLOYMENT'),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
  })
  .strict()

const updateBitbucketCloudTriggerDetailsSchema = z
  .object({
    actions: z
      .array(triggerActionSchema.extend({ filter: bitbucketCloudFilterSchema.optional() }))
      .max(20)
      .optional(),
    definedTags: definedTagsSchema.optional(),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    triggerSource: z.literal('BITBUCKET_CLOUD'),
    connectionId: z.string().min(1).max(255).optional(),
  })
  .strict()

const updateBitbucketServerTriggerDetailsSchema = z
  .object({
    actions: z
      .array(triggerActionSchema.extend({ filter: bitbucketServerFilterSchema.optional() }))
      .max(20)
      .optional(),
    definedTags: definedTagsSchema.optional(),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    triggerSource: z.literal('BITBUCKET_SERVER'),
  })
  .strict()

const updateDevopsCodeRepositoryTriggerDetailsSchema = z
  .object({
    actions: z
      .array(triggerActionSchema.extend({ filter: devopsCodeRepositoryFilterSchema.optional() }))
      .max(20)
      .optional(),
    definedTags: definedTagsSchema.optional(),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    triggerSource: z.literal('DEVOPS_CODE_REPOSITORY'),
    repositoryId: z.string().max(8192).optional(),
  })
  .strict()

const updateGithubTriggerDetailsSchema = z
  .object({
    actions: z
      .array(triggerActionSchema.extend({ filter: githubFilterSchema.optional() }))
      .max(20)
      .optional(),
    definedTags: definedTagsSchema.optional(),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    triggerSource: z.literal('GITHUB'),
    connectionId: z.string().min(1).max(255).optional(),
  })
  .strict()

const updateGitlabServerTriggerDetailsSchema = z
  .object({
    actions: z
      .array(triggerActionSchema.extend({ filter: gitlabServerFilterSchema.optional() }))
      .max(20)
      .optional(),
    definedTags: definedTagsSchema.optional(),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    triggerSource: z.literal('GITLAB_SERVER'),
  })
  .strict()

const updateGitlabTriggerDetailsSchema = z
  .object({
    actions: z
      .array(triggerActionSchema.extend({ filter: gitlabFilterSchema.optional() }))
      .max(20)
      .optional(),
    definedTags: definedTagsSchema.optional(),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    triggerSource: z.literal('GITLAB'),
    connectionId: z.string().min(1).max(255).optional(),
  })
  .strict()

const updateVbsTriggerDetailsSchema = z
  .object({
    actions: z
      .array(triggerActionSchema.extend({ filter: vbsFilterSchema.optional() }))
      .max(20)
      .optional(),
    definedTags: definedTagsSchema.optional(),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    triggerSource: z.literal('VBS'),
    connectionId: z.string().min(1).max(255).optional(),
  })
  .strict()

export const approveDeploymentInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    deploymentId: z.string().max(8192),
    action: z.enum(['APPROVE', 'REJECT']),
    deployStageId: z.string().min(1).max(255),
    reason: z.string().min(1).max(512).optional(),
    retryToken: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[\x21-\x7e]+$/),
    ifMatch: z.string().min(1).max(1024),
  })
  .strict()

export const cancelBuildRunInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    buildRunId: z.string().max(8192),
    reason: z.string().min(1).max(1024),
    retryToken: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[\x21-\x7e]+$/),
    ifMatch: z.string().min(1).max(1024),
  })
  .strict()

export const cancelDeploymentInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    deploymentId: z.string().max(8192),
    reason: z.string().min(1).max(512),
    retryToken: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[\x21-\x7e]+$/),
    ifMatch: z.string().min(1).max(1024),
  })
  .strict()

export const createBuildPipelineInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    buildPipelineParameters: buildPipelineParameterCollectionSchema.optional(),
    definedTags: definedTagsSchema.optional(),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    projectId: z.string().min(1).max(255),
    retryToken: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[\x21-\x7e]+$/),
  })
  .strict()

export const createBuildPipelineStageInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    buildPipelineId: z.string().min(1).max(255),
    stage: z.discriminatedUnion('buildPipelineStageType', [
      createBuildStageDetailsSchema.omit({ buildPipelineId: true }),
      createDeliverArtifactStageDetailsSchema.omit({ buildPipelineId: true }),
      createTriggerDeploymentStageDetailsSchema.omit({ buildPipelineId: true }),
      createWaitStageDetailsSchema.omit({ buildPipelineId: true }),
    ]),
    retryToken: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[\x21-\x7e]+$/),
  })
  .strict()

export const createBuildRunInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    buildPipelineId: z.string().min(1).max(255),
    buildRunArguments: buildRunArgumentCollectionSchema.optional(),
    commitInfo: commitInfoSchema.optional(),
    definedTags: definedTagsSchema.optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    retryToken: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[\x21-\x7e]+$/),
    ifMatch: z.string().min(1).max(1024).optional(),
  })
  .strict()

export const createConnectionInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    projectId: z.string().min(1).max(255),
    connection: z.discriminatedUnion('connectionType', [
      createBitbucketServerAccessTokenConnectionDetailsSchema.omit({ projectId: true }),
      createGithubAccessTokenConnectionDetailsSchema.omit({ projectId: true }),
      createGitlabAccessTokenConnectionDetailsSchema.omit({ projectId: true }),
      createGitlabServerAccessTokenConnectionDetailsSchema.omit({ projectId: true }),
      createVbsAccessTokenConnectionDetailsSchema.omit({ projectId: true }),
    ]),
    retryToken: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[\x21-\x7e]+$/),
  })
  .strict()

export const createDeployArtifactInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    projectId: z.string().min(1).max(255),
    artifact: createDeployArtifactDetailsSchema.omit({ projectId: true }),
    retryToken: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[\x21-\x7e]+$/),
  })
  .strict()

export const createDeployEnvironmentInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    projectId: z.string().min(1).max(255),
    environment: z.discriminatedUnion('deployEnvironmentType', [
      createComputeInstanceGroupDeployEnvironmentDetailsSchema.omit({ projectId: true }),
      createFunctionDeployEnvironmentDetailsSchema.omit({ projectId: true }),
      createOkeClusterDeployEnvironmentDetailsSchema.omit({ projectId: true }),
    ]),
    retryToken: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[\x21-\x7e]+$/),
  })
  .strict()

export const createDeployPipelineInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    definedTags: definedTagsSchema.optional(),
    deployPipelineParameters: deployPipelineParameterCollectionSchema.optional(),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    projectId: z.string().min(1).max(255),
    retryToken: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[\x21-\x7e]+$/),
  })
  .strict()

export const createDeployStageInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    deployPipelineId: z.string().min(1).max(255),
    stage: z.discriminatedUnion('deployStageType', [
      createComputeInstanceGroupBlueGreenDeployStageDetailsSchema.omit({ deployPipelineId: true }),
      createComputeInstanceGroupBlueGreenTrafficShiftDeployStageDetailsSchema.omit({
        deployPipelineId: true,
      }),
      createComputeInstanceGroupCanaryApprovalDeployStageDetailsSchema.omit({
        deployPipelineId: true,
      }),
      createComputeInstanceGroupCanaryDeployStageDetailsSchema.omit({ deployPipelineId: true }),
      createComputeInstanceGroupCanaryTrafficShiftDeployStageDetailsSchema.omit({
        deployPipelineId: true,
      }),
      createComputeInstanceGroupDeployStageDetailsSchema.omit({ deployPipelineId: true }),
      createFunctionDeployStageDetailsSchema.omit({ deployPipelineId: true }),
      createInvokeFunctionDeployStageDetailsSchema.omit({ deployPipelineId: true }),
      createLoadBalancerTrafficShiftDeployStageDetailsSchema.omit({ deployPipelineId: true }),
      createManualApprovalDeployStageDetailsSchema.omit({ deployPipelineId: true }),
      createOkeBlueGreenDeployStageDetailsSchema.omit({ deployPipelineId: true }),
      createOkeBlueGreenTrafficShiftDeployStageDetailsSchema.omit({ deployPipelineId: true }),
      createOkeCanaryApprovalDeployStageDetailsSchema.omit({ deployPipelineId: true }),
      createOkeCanaryDeployStageDetailsSchema.omit({ deployPipelineId: true }),
      createOkeCanaryTrafficShiftDeployStageDetailsSchema.omit({ deployPipelineId: true }),
      createOkeDeployStageDetailsSchema.omit({ deployPipelineId: true }),
      createOkeHelmChartDeployStageDetailsSchema.omit({ deployPipelineId: true }),
      createShellDeployStageDetailsSchema.omit({ deployPipelineId: true }),
      createWaitDeployStageDetailsSchema.omit({ deployPipelineId: true }),
    ]),
    retryToken: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[\x21-\x7e]+$/),
  })
  .strict()

export const createDeploymentInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    deployPipelineId: z.string().min(1).max(255),
    deployment: z.discriminatedUnion('deploymentType', [
      createDeployPipelineDeploymentDetailsSchema.omit({ deployPipelineId: true }),
      createDeployPipelineRedeploymentDetailsSchema.omit({ deployPipelineId: true }),
      createSingleDeployStageDeploymentDetailsSchema.omit({ deployPipelineId: true }),
      createSingleDeployStageRedeploymentDetailsSchema
        .omit({ deployPipelineId: true })
        .extend({ previousDeploymentId: z.string().min(1).max(255) }),
    ]),
    retryToken: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[\x21-\x7e]+$/),
  })
  .strict()

export const createProjectInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    compartmentId: z.string().min(1).max(255),
    definedTags: definedTagsSchema.optional(),
    description: z.string().max(400).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    name: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[a-zA-Z][a-zA-Z_0-9]*$/),
    notificationConfig: notificationConfigSchema,
    retryToken: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[\x21-\x7e]+$/),
  })
  .strict()

export const createRepositoryInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    defaultBranch: z.string().min(1).max(255).optional(),
    definedTags: definedTagsSchema.optional(),
    description: z.string().max(400).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    mirrorRepositoryConfig: mirrorRepositoryConfigSchema.optional(),
    name: z.string().min(1).max(255),
    parentRepositoryId: z.string().min(1).max(255).optional(),
    projectId: z.string().min(1).max(255),
    repositoryType: z.enum(['MIRRORED', 'HOSTED', 'FORKED']),
    retryToken: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[\x21-\x7e]+$/),
  })
  .strict()

export const createTriggerInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    projectId: z.string().min(1).max(255),
    trigger: createDevopsCodeRepositoryTriggerDetailsSchema
      .omit({ projectId: true })
      .extend({ repositoryId: z.string().min(1).max(255) }),
    retryToken: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[\x21-\x7e]+$/),
  })
  .strict()

export const deleteBuildPipelineInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    buildPipelineId: z.string().max(8192),
    ifMatch: z.string().min(1).max(1024),
  })
  .strict()

export const deleteBuildPipelineStageInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    buildPipelineStageId: z.string().max(8192),
    ifMatch: z.string().min(1).max(1024),
  })
  .strict()

export const deleteConnectionInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    connectionId: z.string().max(8192),
    ifMatch: z.string().min(1).max(1024),
  })
  .strict()

export const deleteDeployArtifactInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    deployArtifactId: z.string().max(8192),
    ifMatch: z.string().min(1).max(1024),
  })
  .strict()

export const deleteDeployEnvironmentInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    deployEnvironmentId: z.string().max(8192),
    ifMatch: z.string().min(1).max(1024),
  })
  .strict()

export const deleteDeployPipelineInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    deployPipelineId: z.string().max(8192),
    ifMatch: z.string().min(1).max(1024),
  })
  .strict()

export const deleteDeployStageInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    deployStageId: z.string().max(8192),
    ifMatch: z.string().min(1).max(1024),
  })
  .strict()

export const deleteProjectInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    projectId: z.string().max(8192),
    ifMatch: z.string().min(1).max(1024),
  })
  .strict()

export const deleteRepositoryInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    repositoryId: z.string().max(8192),
    ifMatch: z.string().min(1).max(1024),
  })
  .strict()

export const deleteTriggerInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    triggerId: z.string().max(8192),
    ifMatch: z.string().min(1).max(1024),
  })
  .strict()

export const getBuildPipelineInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    buildPipelineId: z.string().max(8192),
  })
  .strict()

export const getBuildPipelineStageInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    buildPipelineStageId: z.string().max(8192),
  })
  .strict()

export const getBuildRunInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    buildRunId: z.string().max(8192),
  })
  .strict()

export const getCommitInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    repositoryId: z.string().max(8192),
    commitId: z.string().min(1).max(255),
  })
  .strict()

export const getConnectionInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    connectionId: z.string().max(8192),
  })
  .strict()

export const getDeployArtifactInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    deployArtifactId: z.string().max(8192),
  })
  .strict()

export const getDeployEnvironmentInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    deployEnvironmentId: z.string().max(8192),
  })
  .strict()

export const getDeployPipelineInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    deployPipelineId: z.string().max(8192),
  })
  .strict()

export const getDeployStageInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    deployStageId: z.string().max(8192),
  })
  .strict()

export const getDeploymentInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    deploymentId: z.string().max(8192),
  })
  .strict()

export const getProjectInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    projectId: z.string().max(8192),
  })
  .strict()

export const getRepositoryInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    repositoryId: z.string().max(8192),
    fields: z
      .array(z.enum(['branchCount', 'commitCount', 'sizeInBytes']))
      .max(100)
      .optional(),
  })
  .strict()

export const getTriggerInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    triggerId: z.string().max(8192),
  })
  .strict()

export const getWorkRequestInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    workRequestId: z.string().max(8192),
  })
  .strict()

export const listBuildPipelineStagesInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    id: z.string().max(8192).optional(),
    buildPipelineId: z.string().trim().min(1).max(255),
    compartmentId: z.string().max(8192).optional(),
    lifecycleState: z
      .enum(['CREATING', 'UPDATING', 'ACTIVE', 'DELETING', 'DELETED', 'FAILED'])
      .optional(),
    displayName: z.string().min(1).max(255).optional(),
    limit: z.number().int().min(1).max(100).default(50),
    page: z.string().min(1).max(4096).optional(),
    sortOrder: z.enum(['ASC', 'DESC']).optional(),
    sortBy: z.enum(['timeCreated', 'displayName']).optional(),
  })
  .strict()

export const listBuildPipelinesInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    id: z.string().max(8192).optional(),
    projectId: z.string().trim().min(1).max(255),
    compartmentId: z.string().max(8192).optional(),
    lifecycleState: z
      .enum(['CREATING', 'UPDATING', 'ACTIVE', 'INACTIVE', 'DELETING', 'DELETED', 'FAILED'])
      .optional(),
    displayName: z.string().min(1).max(255).optional(),
    limit: z.number().int().min(1).max(100).default(50),
    page: z.string().min(1).max(4096).optional(),
    sortOrder: z.enum(['ASC', 'DESC']).optional(),
    sortBy: z.enum(['timeCreated', 'displayName']).optional(),
  })
  .strict()

export const listBuildRunsInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    id: z.string().max(8192).optional(),
    buildPipelineId: z.string().trim().min(1).max(255),
    projectId: z.string().max(8192).optional(),
    compartmentId: z.string().max(8192).optional(),
    displayName: z.string().min(1).max(255).optional(),
    lifecycleState: z
      .enum(['ACCEPTED', 'IN_PROGRESS', 'FAILED', 'SUCCEEDED', 'CANCELING', 'CANCELED', 'DELETING'])
      .optional(),
    limit: z.number().int().min(1).max(100).default(50),
    page: z.string().min(1).max(4096).optional(),
    sortOrder: z.enum(['ASC', 'DESC']).optional(),
    sortBy: z.enum(['timeCreated', 'displayName']).optional(),
  })
  .strict()

export const listCommitsInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    repositoryId: z.string().max(8192),
    refName: z.string().min(1).max(255).optional(),
    excludeRefName: z.string().min(1).max(255).optional(),
    filePath: z.string().min(1).max(255).optional(),
    timestampGreaterThanOrEqualTo: z.string().max(8192).optional(),
    timestampLessThanOrEqualTo: z.string().max(8192).optional(),
    commitMessage: z.string().min(1).max(255).optional(),
    authorName: z.string().min(1).max(255).optional(),
    limit: z.number().int().min(1).max(100).default(50),
    page: z.string().min(1).max(4096).optional(),
  })
  .strict()

export const listConnectionsInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    id: z.string().max(8192).optional(),
    projectId: z.string().trim().min(1).max(255),
    compartmentId: z.string().max(8192).optional(),
    lifecycleState: z.enum(['ACTIVE', 'DELETING']).optional(),
    displayName: z.string().min(1).max(255).optional(),
    connectionType: z
      .enum([
        'GITHUB_ACCESS_TOKEN',
        'GITLAB_ACCESS_TOKEN',
        'GITLAB_SERVER_ACCESS_TOKEN',
        'BITBUCKET_SERVER_ACCESS_TOKEN',
        'BITBUCKET_CLOUD_APP_PASSWORD',
        'VBS_ACCESS_TOKEN',
      ])
      .optional(),
    limit: z.number().int().min(1).max(100).default(50),
    page: z.string().min(1).max(4096).optional(),
    sortOrder: z.enum(['ASC', 'DESC']).optional(),
    sortBy: z.enum(['timeCreated', 'displayName']).optional(),
  })
  .strict()

export const listDeployArtifactsInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    id: z.string().max(8192).optional(),
    projectId: z.string().trim().min(1).max(255),
    compartmentId: z.string().max(8192).optional(),
    lifecycleState: z
      .enum(['CREATING', 'UPDATING', 'ACTIVE', 'DELETING', 'DELETED', 'FAILED'])
      .optional(),
    displayName: z.string().min(1).max(255).optional(),
    limit: z.number().int().min(1).max(100).default(50),
    page: z.string().min(1).max(4096).optional(),
    sortOrder: z.enum(['ASC', 'DESC']).optional(),
    sortBy: z.enum(['timeCreated', 'displayName']).optional(),
  })
  .strict()

export const listDeployEnvironmentsInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    projectId: z.string().trim().min(1).max(255),
    compartmentId: z.string().max(8192).optional(),
    id: z.string().max(8192).optional(),
    lifecycleState: z
      .enum(['CREATING', 'UPDATING', 'ACTIVE', 'DELETING', 'DELETED', 'FAILED', 'NEEDS_ATTENTION'])
      .optional(),
    displayName: z.string().min(1).max(255).optional(),
    limit: z.number().int().min(1).max(100).default(50),
    page: z.string().min(1).max(4096).optional(),
    sortOrder: z.enum(['ASC', 'DESC']).optional(),
    sortBy: z.enum(['timeCreated', 'displayName']).optional(),
  })
  .strict()

export const listDeployPipelinesInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    id: z.string().max(8192).optional(),
    projectId: z.string().trim().min(1).max(255),
    compartmentId: z.string().max(8192).optional(),
    lifecycleState: z
      .enum(['CREATING', 'UPDATING', 'ACTIVE', 'INACTIVE', 'DELETING', 'DELETED', 'FAILED'])
      .optional(),
    displayName: z.string().min(1).max(255).optional(),
    limit: z.number().int().min(1).max(100).default(50),
    page: z.string().min(1).max(4096).optional(),
    sortOrder: z.enum(['ASC', 'DESC']).optional(),
    sortBy: z.enum(['timeCreated', 'displayName']).optional(),
  })
  .strict()

export const listDeployStagesInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    id: z.string().max(8192).optional(),
    deployPipelineId: z.string().trim().min(1).max(255),
    compartmentId: z.string().max(8192).optional(),
    lifecycleState: z
      .enum(['CREATING', 'UPDATING', 'ACTIVE', 'DELETING', 'DELETED', 'FAILED'])
      .optional(),
    displayName: z.string().min(1).max(255).optional(),
    limit: z.number().int().min(1).max(100).default(50),
    page: z.string().min(1).max(4096).optional(),
    sortOrder: z.enum(['ASC', 'DESC']).optional(),
    sortBy: z.enum(['timeCreated', 'displayName']).optional(),
  })
  .strict()

export const listDeploymentsInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    deployPipelineId: z.string().trim().min(1).max(255),
    id: z.string().max(8192).optional(),
    compartmentId: z.string().max(8192).optional(),
    projectId: z.string().max(8192).optional(),
    lifecycleState: z
      .enum(['ACCEPTED', 'IN_PROGRESS', 'FAILED', 'SUCCEEDED', 'CANCELING', 'CANCELED'])
      .optional(),
    displayName: z.string().min(1).max(255).optional(),
    limit: z.number().int().min(1).max(100).default(50),
    page: z.string().min(1).max(4096).optional(),
    sortOrder: z.enum(['ASC', 'DESC']).optional(),
    sortBy: z.enum(['timeCreated', 'displayName']).optional(),
    timeCreatedLessThan: z.string().max(8192).optional(),
    timeCreatedGreaterThanOrEqualTo: z.string().max(8192).optional(),
  })
  .strict()

export const listPathsInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    repositoryId: z.string().max(8192),
    ref: z.string().max(8192).optional(),
    pathsInSubtree: z.boolean().optional(),
    folderPath: z.string().max(8192).optional(),
    limit: z.number().int().min(1).max(100).default(50),
    page: z.string().min(1).max(4096).optional(),
    displayName: z.string().min(1).max(255).optional(),
    sortOrder: z.enum(['ASC', 'DESC']).optional(),
    sortBy: z.enum(['type', 'sizeInBytes', 'name']).optional(),
  })
  .strict()

export const listProjectsInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    id: z.string().max(8192).optional(),
    compartmentId: z.string().trim().min(1).max(255),
    lifecycleState: z
      .enum(['CREATING', 'UPDATING', 'ACTIVE', 'DELETING', 'DELETED', 'FAILED', 'NEEDS_ATTENTION'])
      .optional(),
    name: z.string().min(1).max(255).optional(),
    limit: z.number().int().min(1).max(100).default(50),
    page: z.string().min(1).max(4096).optional(),
    sortOrder: z.enum(['ASC', 'DESC']).optional(),
    sortBy: z.enum(['timeCreated', 'displayName']).optional(),
  })
  .strict()

export const listRefsInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    repositoryId: z.string().max(8192),
    refType: z.enum(['BRANCH', 'TAG']).optional(),
    commitId: z.string().max(8192).optional(),
    limit: z.number().int().min(1).max(100).default(50),
    page: z.string().min(1).max(4096).optional(),
    refName: z.string().min(1).max(255).optional(),
    sortOrder: z.enum(['ASC', 'DESC']).optional(),
    sortBy: z.enum(['refType', 'refName']).optional(),
  })
  .strict()

export const listRepositoriesInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    compartmentId: z.string().max(8192).optional(),
    projectId: z.string().trim().min(1).max(255),
    repositoryId: z.string().max(8192).optional(),
    lifecycleState: z.enum(['ACTIVE', 'CREATING', 'DELETED', 'FAILED', 'DELETING']).optional(),
    name: z.string().min(1).max(255).optional(),
    limit: z.number().int().min(1).max(100).default(50),
    page: z.string().min(1).max(4096).optional(),
    sortOrder: z.enum(['ASC', 'DESC']).optional(),
    sortBy: z.enum(['timeCreated', 'name']).optional(),
  })
  .strict()

export const listTriggersInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    compartmentId: z.string().max(8192).optional(),
    projectId: z.string().trim().min(1).max(255),
    lifecycleState: z.enum(['ACTIVE', 'DELETING']).optional(),
    displayName: z.string().min(1).max(255).optional(),
    id: z.string().max(8192).optional(),
    limit: z.number().int().min(1).max(100).default(50),
    page: z.string().min(1).max(4096).optional(),
    sortOrder: z.enum(['ASC', 'DESC']).optional(),
    sortBy: z.enum(['timeCreated', 'displayName']).optional(),
  })
  .strict()

export const listWorkRequestErrorsInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    workRequestId: z.string().max(8192),
    page: z.string().min(1).max(4096).optional(),
    limit: z.number().int().min(1).max(100).default(50),
    sortOrder: z.enum(['ASC', 'DESC']).optional(),
    sortBy: z.literal('timeAccepted').optional(),
  })
  .strict()

export const listWorkRequestsInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    compartmentId: z.string().trim().min(1).max(255),
    workRequestId: z.string().max(8192).optional(),
    status: z
      .enum([
        'ACCEPTED',
        'IN_PROGRESS',
        'FAILED',
        'SUCCEEDED',
        'CANCELING',
        'CANCELED',
        'WAITING',
        'NEEDS_ATTENTION',
      ])
      .optional(),
    resourceId: z.string().max(8192).optional(),
    page: z.string().min(1).max(4096).optional(),
    limit: z.number().int().min(1).max(100).default(50),
    sortOrder: z.enum(['ASC', 'DESC']).optional(),
    sortBy: z.literal('timeAccepted').optional(),
    operationTypeMultiValueQuery: z.array(z.string().max(8192)).max(100).optional(),
  })
  .strict()

export const updateBuildPipelineInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    buildPipelineId: z.string().max(8192),
    buildPipelineParameters: buildPipelineParameterCollectionSchema.optional(),
    definedTags: definedTagsSchema.optional(),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    ifMatch: z.string().min(1).max(1024),
  })
  .strict()

export const updateBuildPipelineStageInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    buildPipelineStageId: z.string().max(8192),
    stage: z.discriminatedUnion('buildPipelineStageType', [
      updateBuildStageDetailsSchema,
      updateDeliverArtifactStageDetailsSchema,
      updateTriggerDeploymentStageDetailsSchema,
      updateWaitStageDetailsSchema,
    ]),
    ifMatch: z.string().min(1).max(1024),
  })
  .strict()

export const updateBuildRunInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    buildRunId: z.string().max(8192),
    definedTags: definedTagsSchema.optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    ifMatch: z.string().min(1).max(1024),
  })
  .strict()

export const updateConnectionInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    connectionId: z.string().max(8192),
    connection: z.discriminatedUnion('connectionType', [
      updateBitbucketServerAccessTokenConnectionDetailsSchema,
      updateGithubAccessTokenConnectionDetailsSchema,
      updateGitlabAccessTokenConnectionDetailsSchema,
      updateGitlabServerAccessTokenConnectionDetailsSchema,
      updateVbsAccessTokenConnectionDetailsSchema,
    ]),
    ifMatch: z.string().min(1).max(1024),
  })
  .strict()

export const updateDeployArtifactInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    deployArtifactId: z.string().max(8192),
    artifact: updateDeployArtifactDetailsSchema,
    ifMatch: z.string().min(1).max(1024),
  })
  .strict()

export const updateDeployEnvironmentInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    deployEnvironmentId: z.string().max(8192),
    environment: z.discriminatedUnion('deployEnvironmentType', [
      updateComputeInstanceGroupDeployEnvironmentDetailsSchema,
      updateFunctionDeployEnvironmentDetailsSchema,
      updateOkeClusterDeployEnvironmentDetailsSchema,
    ]),
    ifMatch: z.string().min(1).max(1024),
  })
  .strict()

export const updateDeployPipelineInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    deployPipelineId: z.string().max(8192),
    definedTags: definedTagsSchema.optional(),
    deployPipelineParameters: deployPipelineParameterCollectionSchema.optional(),
    description: z.string().max(400).optional(),
    displayName: z.string().min(1).max(255).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    ifMatch: z.string().min(1).max(1024),
  })
  .strict()

export const updateDeployStageInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    deployStageId: z.string().max(8192),
    stage: z.discriminatedUnion('deployStageType', [
      updateComputeInstanceGroupBlueGreenDeployStageDetailsSchema,
      updateComputeInstanceGroupBlueGreenTrafficShiftDeployStageDetailsSchema,
      updateComputeInstanceGroupCanaryApprovalDeployStageDetailsSchema,
      updateComputeInstanceGroupCanaryDeployStageDetailsSchema,
      updateComputeInstanceGroupCanaryTrafficShiftDeployStageDetailsSchema,
      updateComputeInstanceGroupDeployStageDetailsSchema,
      updateFunctionDeployStageDetailsSchema,
      updateInvokeFunctionDeployStageDetailsSchema,
      updateLoadBalancerTrafficShiftDeployStageDetailsSchema,
      updateManualApprovalDeployStageDetailsSchema,
      updateOkeBlueGreenDeployStageDetailsSchema,
      updateOkeBlueGreenTrafficShiftDeployStageDetailsSchema,
      updateOkeCanaryApprovalDeployStageDetailsSchema,
      updateOkeCanaryDeployStageDetailsSchema,
      updateOkeCanaryTrafficShiftDeployStageDetailsSchema,
      updateOkeDeployStageDetailsSchema,
      updateOkeHelmChartDeployStageDetailsSchema,
      updateShellDeployStageDetailsSchema,
      updateWaitDeployStageDetailsSchema,
    ]),
    ifMatch: z.string().min(1).max(1024),
  })
  .strict()

export const updateDeploymentInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    deploymentId: z.string().max(8192),
    deployment: z.discriminatedUnion('deploymentType', [
      updateDeployPipelineDeploymentDetailsSchema,
      updateDeployPipelineRedeploymentDetailsSchema,
      updateSingleDeployStageDeploymentDetailsSchema,
      updateSingleDeployStageRedeploymentDetailsSchema,
    ]),
    ifMatch: z.string().min(1).max(1024),
  })
  .strict()

export const updateProjectInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    projectId: z.string().max(8192),
    definedTags: definedTagsSchema.optional(),
    description: z.string().max(400).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    notificationConfig: notificationConfigSchema.optional(),
    ifMatch: z.string().min(1).max(1024),
  })
  .strict()

export const updateRepositoryInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    repositoryId: z.string().max(8192),
    defaultBranch: z.string().min(1).max(255).optional(),
    definedTags: definedTagsSchema.optional(),
    description: z.string().max(400).optional(),
    freeformTags: z.record(z.string().max(255), z.string().max(8192)).optional(),
    mirrorRepositoryConfig: mirrorRepositoryConfigSchema.optional(),
    name: z.string().min(1).max(255).optional(),
    repositoryType: z.enum(['MIRRORED', 'HOSTED', 'FORKED']).optional(),
    ifMatch: z.string().min(1).max(1024),
  })
  .strict()

export const updateTriggerInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    triggerId: z.string().max(8192),
    trigger: z.discriminatedUnion('triggerSource', [
      updateBitbucketCloudTriggerDetailsSchema,
      updateBitbucketServerTriggerDetailsSchema,
      updateDevopsCodeRepositoryTriggerDetailsSchema,
      updateGithubTriggerDetailsSchema,
      updateGitlabServerTriggerDetailsSchema,
      updateGitlabTriggerDetailsSchema,
      updateVbsTriggerDetailsSchema,
    ]),
    ifMatch: z.string().min(1).max(1024),
  })
  .strict()

export const validateConnectionInputSchema = z
  .object({
    oauthCredential: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(255).optional(),
    connectionId: z.string().max(8192),
    retryToken: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[\x21-\x7e]+$/),
    ifMatch: z.string().min(1).max(1024),
  })
  .strict()

export const operationSchemas = {
  approve_deployment: approveDeploymentInputSchema,
  cancel_build_run: cancelBuildRunInputSchema,
  cancel_deployment: cancelDeploymentInputSchema,
  create_build_pipeline: createBuildPipelineInputSchema,
  create_build_pipeline_stage: createBuildPipelineStageInputSchema,
  create_build_run: createBuildRunInputSchema,
  create_connection: createConnectionInputSchema,
  create_deploy_artifact: createDeployArtifactInputSchema,
  create_deploy_environment: createDeployEnvironmentInputSchema,
  create_deploy_pipeline: createDeployPipelineInputSchema,
  create_deploy_stage: createDeployStageInputSchema,
  create_deployment: createDeploymentInputSchema,
  create_project: createProjectInputSchema,
  create_repository: createRepositoryInputSchema,
  create_trigger: createTriggerInputSchema,
  delete_build_pipeline: deleteBuildPipelineInputSchema,
  delete_build_pipeline_stage: deleteBuildPipelineStageInputSchema,
  delete_connection: deleteConnectionInputSchema,
  delete_deploy_artifact: deleteDeployArtifactInputSchema,
  delete_deploy_environment: deleteDeployEnvironmentInputSchema,
  delete_deploy_pipeline: deleteDeployPipelineInputSchema,
  delete_deploy_stage: deleteDeployStageInputSchema,
  delete_project: deleteProjectInputSchema,
  delete_repository: deleteRepositoryInputSchema,
  delete_trigger: deleteTriggerInputSchema,
  get_build_pipeline: getBuildPipelineInputSchema,
  get_build_pipeline_stage: getBuildPipelineStageInputSchema,
  get_build_run: getBuildRunInputSchema,
  get_commit: getCommitInputSchema,
  get_connection: getConnectionInputSchema,
  get_deploy_artifact: getDeployArtifactInputSchema,
  get_deploy_environment: getDeployEnvironmentInputSchema,
  get_deploy_pipeline: getDeployPipelineInputSchema,
  get_deploy_stage: getDeployStageInputSchema,
  get_deployment: getDeploymentInputSchema,
  get_project: getProjectInputSchema,
  get_repository: getRepositoryInputSchema,
  get_trigger: getTriggerInputSchema,
  get_work_request: getWorkRequestInputSchema,
  list_build_pipeline_stages: listBuildPipelineStagesInputSchema,
  list_build_pipelines: listBuildPipelinesInputSchema,
  list_build_runs: listBuildRunsInputSchema,
  list_commits: listCommitsInputSchema,
  list_connections: listConnectionsInputSchema,
  list_deploy_artifacts: listDeployArtifactsInputSchema,
  list_deploy_environments: listDeployEnvironmentsInputSchema,
  list_deploy_pipelines: listDeployPipelinesInputSchema,
  list_deploy_stages: listDeployStagesInputSchema,
  list_deployments: listDeploymentsInputSchema,
  list_paths: listPathsInputSchema,
  list_projects: listProjectsInputSchema,
  list_refs: listRefsInputSchema,
  list_repositories: listRepositoriesInputSchema,
  list_triggers: listTriggersInputSchema,
  list_work_request_errors: listWorkRequestErrorsInputSchema,
  list_work_requests: listWorkRequestsInputSchema,
  update_build_pipeline: updateBuildPipelineInputSchema,
  update_build_pipeline_stage: updateBuildPipelineStageInputSchema,
  update_build_run: updateBuildRunInputSchema,
  update_connection: updateConnectionInputSchema,
  update_deploy_artifact: updateDeployArtifactInputSchema,
  update_deploy_environment: updateDeployEnvironmentInputSchema,
  update_deploy_pipeline: updateDeployPipelineInputSchema,
  update_deploy_stage: updateDeployStageInputSchema,
  update_deployment: updateDeploymentInputSchema,
  update_project: updateProjectInputSchema,
  update_repository: updateRepositoryInputSchema,
  update_trigger: updateTriggerInputSchema,
  validate_connection: validateConnectionInputSchema,
} as const

const responseTextSchema = z.string().max(8192)
const optionalResponseTextSchema = responseTextSchema
  .nullish()
  .transform((value) => value ?? undefined)
const responsePredecessorsSchema = z.object({
  items: z.array(z.object({ id: responseTextSchema })).max(100),
})
const responseParameterCollectionSchema = z.object({
  items: z
    .array(
      z.object({
        name: responseTextSchema,
        description: responseTextSchema.nullish(),
      })
    )
    .max(100),
})
const responseStageProgressSchema = z.object({
  buildPipelineStageId: responseTextSchema.nullish(),
  buildPipelineStageType: responseTextSchema.nullish(),
  stageDisplayName: responseTextSchema.nullish(),
  deployStageId: responseTextSchema.nullish(),
  deployStageType: responseTextSchema.nullish(),
  deployStageDisplayName: responseTextSchema.nullish(),
  status: responseTextSchema.nullish(),
  timeStarted: responseTextSchema.nullish(),
  timeFinished: responseTextSchema.nullish(),
  buildPipelineStagePredecessors: responsePredecessorsSchema.nullish(),
  deployStagePredecessors: responsePredecessorsSchema.nullish(),
})
const responseStageProgressMapSchema = z
  .record(z.string().max(255), responseStageProgressSchema)
  .refine((stages) => Object.keys(stages).length <= 100, 'Too many stage summaries')

/** Allowlisted provider metadata; unknown and secret-bearing response fields are omitted. */
export const resourceSchema = z.object({
  id: optionalResponseTextSchema,
  projectId: optionalResponseTextSchema,
  compartmentId: optionalResponseTextSchema,
  buildPipelineId: optionalResponseTextSchema,
  buildPipelineStageId: optionalResponseTextSchema,
  deployPipelineId: optionalResponseTextSchema,
  deployStageId: optionalResponseTextSchema,
  repositoryId: optionalResponseTextSchema,
  name: optionalResponseTextSchema,
  displayName: optionalResponseTextSchema,
  description: optionalResponseTextSchema,
  lifecycleState: optionalResponseTextSchema,
  timeCreated: optionalResponseTextSchema,
  timeUpdated: optionalResponseTextSchema,
  timeStarted: optionalResponseTextSchema,
  timeFinished: optionalResponseTextSchema,
  timeAccepted: optionalResponseTextSchema,
  buildPipelineStageType: optionalResponseTextSchema,
  deployStageType: optionalResponseTextSchema,
  deployEnvironmentType: optionalResponseTextSchema,
  deployArtifactType: optionalResponseTextSchema,
  connectionType: optionalResponseTextSchema,
  triggerSource: optionalResponseTextSchema,
  deploymentType: optionalResponseTextSchema,
  repositoryType: optionalResponseTextSchema,
  defaultBranch: optionalResponseTextSchema,
  refName: optionalResponseTextSchema,
  fullRefName: optionalResponseTextSchema,
  refType: optionalResponseTextSchema,
  commitId: optionalResponseTextSchema,
  commitMessage: optionalResponseTextSchema,
  authorName: optionalResponseTextSchema,
  treeId: optionalResponseTextSchema,
  operationType: optionalResponseTextSchema,
  status: optionalResponseTextSchema,
  code: optionalResponseTextSchema,
  timestamp: optionalResponseTextSchema,
  functionId: optionalResponseTextSchema,
  clusterId: optionalResponseTextSchema,
  namespace: optionalResponseTextSchema,
  releaseName: optionalResponseTextSchema,
  functionDeployEnvironmentId: optionalResponseTextSchema,
  dockerImageDeployArtifactId: optionalResponseTextSchema,
  okeClusterDeployEnvironmentId: optionalResponseTextSchema,
  helmChartDeployArtifactId: optionalResponseTextSchema,
  computeInstanceGroupDeployEnvironmentId: optionalResponseTextSchema,
  deploymentSpecDeployArtifactId: optionalResponseTextSchema,
  commandSpecDeployArtifactId: optionalResponseTextSchema,
  deployEnvironmentIdA: optionalResponseTextSchema,
  deployEnvironmentIdB: optionalResponseTextSchema,
  argumentSubstitutionMode: optionalResponseTextSchema,
  deployArtifactId: optionalResponseTextSchema,
  previousDeploymentId: optionalResponseTextSchema,
  path: optionalResponseTextSchema,
  type: optionalResponseTextSchema,
  sha: z
    .string()
    .max(255)
    .nullish()
    .transform((value) => value ?? undefined),
  objectId: optionalResponseTextSchema,
  branchCount: z
    .number()
    .int()
    .nonnegative()
    .nullish()
    .transform((value) => value ?? undefined),
  commitCount: z
    .number()
    .int()
    .nonnegative()
    .nullish()
    .transform((value) => value ?? undefined),
  sizeInBytes: z
    .number()
    .int()
    .nonnegative()
    .nullish()
    .transform((value) => value ?? undefined),
  percentComplete: z
    .number()
    .min(0)
    .max(100)
    .nullish()
    .transform((value) => value ?? undefined),
  buildPipelineStagePredecessorCollection: responsePredecessorsSchema
    .nullish()
    .transform((value) => value ?? undefined),
  deployStagePredecessorCollection: responsePredecessorsSchema
    .nullish()
    .transform((value) => value ?? undefined),
  buildPipelineParameters: responseParameterCollectionSchema
    .nullish()
    .transform((value) => value ?? undefined),
  deployPipelineParameters: responseParameterCollectionSchema
    .nullish()
    .transform((value) => value ?? undefined),
  lastConnectionValidationResult: z
    .object({
      result: responseTextSchema.nullish(),
      timeValidated: responseTextSchema.nullish(),
    })
    .nullish()
    .transform((value) => value ?? undefined),
  buildRunProgress: z
    .object({
      buildPipelineStageRunProgress: responseStageProgressMapSchema.nullish(),
      timeStarted: responseTextSchema.nullish(),
      timeFinished: responseTextSchema.nullish(),
    })
    .nullish()
    .transform((value) => value ?? undefined),
  deploymentExecutionProgress: z
    .object({
      deployStageExecutionProgress: responseStageProgressMapSchema.nullish(),
      timeStarted: responseTextSchema.nullish(),
      timeFinished: responseTextSchema.nullish(),
    })
    .nullish()
    .transform((value) => value ?? undefined),
  deployArtifactSource: z
    .object({
      deployArtifactSourceType: responseTextSchema,
      repositoryId: responseTextSchema.nullish(),
      deployArtifactPath: responseTextSchema.nullish(),
      deployArtifactVersion: responseTextSchema.nullish(),
    })
    .nullish()
    .transform((value) => value ?? undefined),
  parentCommitIds: z
    .array(responseTextSchema)
    .max(100)
    .nullish()
    .transform((value) => value ?? undefined),
  resources: z
    .array(
      z.object({
        actionType: responseTextSchema,
        entityType: responseTextSchema,
        identifier: responseTextSchema,
      })
    )
    .max(100)
    .nullish()
    .transform((value) => value ?? undefined),
})
