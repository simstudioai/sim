/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { operationSchemas } from '@/lib/internal/oci-devops/schema'

const credential = { oauthCredential: 'credential' }
const submission = { ...credential, retryToken: 'one-logical-submission' }
const predecessors = { items: [{ id: 'pipeline' }] }

describe('OCI DevOps request contracts', () => {
  it('defaults to one 50-item page and rejects out-of-range pagination', () => {
    const schema = operationSchemas.list_projects
    expect(schema.parse({ ...credential, compartmentId: 'c' }).limit).toBe(50)
    for (const limit of [0, 101, 1.5]) {
      expect(schema.safeParse({ ...credential, compartmentId: 'c', limit }).success).toBe(false)
    }
    expect(
      schema.safeParse({ ...credential, compartmentId: 'c', page: 'x'.repeat(4097) }).success
    ).toBe(false)
  })

  it('requires explicit stable tokens and conditional ETags', () => {
    expect(
      operationSchemas.create_build_run.safeParse({ ...credential, buildPipelineId: 'p' }).success
    ).toBe(false)
    expect(
      operationSchemas.delete_project.safeParse({ ...credential, projectId: 'p' }).success
    ).toBe(false)
    expect(
      operationSchemas.create_build_run.safeParse({ ...submission, buildPipelineId: 'p' }).success
    ).toBe(true)
  })

  it.each([
    {
      buildPipelineStageType: 'BUILD',
      image: 'OL7_X86_64_STANDARD_10',
      buildSourceCollection: {
        items: [
          {
            connectionType: 'DEVOPS_CODE_REPOSITORY',
            name: 'source',
            repositoryId: 'repository',
            repositoryUrl: 'https://example.com/repository',
            branch: 'main',
          },
        ],
      },
    },
    {
      buildPipelineStageType: 'DELIVER_ARTIFACT',
      deliverArtifactCollection: { items: [{ artifactId: 'artifact', artifactName: 'image' }] },
    },
    {
      buildPipelineStageType: 'TRIGGER_DEPLOYMENT_PIPELINE',
      deployPipelineId: 'deploy',
      isPassAllParametersEnabled: false,
    },
    {
      buildPipelineStageType: 'WAIT',
      waitCriteria: { waitType: 'ABSOLUTE_WAIT', waitDuration: 'PT30S' },
    },
  ])('accepts the documented $buildPipelineStageType build subtype', (stage) => {
    expect(
      operationSchemas.create_build_pipeline_stage.safeParse({
        ...submission,
        buildPipelineId: 'pipeline',
        stage: { ...stage, buildPipelineStagePredecessorCollection: predecessors },
      }).success
    ).toBe(true)
  })

  it('uses distinct create and update schemas and rejects cross-subtype fields', () => {
    const update = {
      ...credential,
      ifMatch: 'etag',
      buildPipelineStageId: 'stage',
      stage: { buildPipelineStageType: 'WAIT', displayName: 'Renamed' },
    }
    expect(operationSchemas.update_build_pipeline_stage.safeParse(update).success).toBe(true)
    expect(
      operationSchemas.create_build_pipeline_stage.safeParse({
        ...submission,
        buildPipelineId: 'p',
        stage: update.stage,
      }).success
    ).toBe(false)
    expect(
      operationSchemas.update_build_pipeline_stage.safeParse({
        ...update,
        stage: { ...update.stage, image: 'OL7_X86_64_STANDARD_10' },
      }).success
    ).toBe(false)
  })

  it.each([
    { deploymentType: 'PIPELINE_DEPLOYMENT' },
    { deploymentType: 'PIPELINE_REDEPLOYMENT', previousDeploymentId: 'previous' },
    { deploymentType: 'SINGLE_STAGE_DEPLOYMENT', deployStageId: 'stage' },
    {
      deploymentType: 'SINGLE_STAGE_REDEPLOYMENT',
      deployStageId: 'stage',
      previousDeploymentId: 'previous',
    },
  ])('accepts $deploymentType with explicit references', (deployment) => {
    expect(
      operationSchemas.create_deployment.safeParse({
        ...submission,
        deployPipelineId: 'pipeline',
        deployment,
      }).success
    ).toBe(true)
  })

  it('requires the explicit previous execution for single-stage redeployment', () => {
    expect(
      operationSchemas.create_deployment.safeParse({
        ...submission,
        deployPipelineId: 'p',
        deployment: { deploymentType: 'SINGLE_STAGE_REDEPLOYMENT', deployStageId: 's' },
      }).success
    ).toBe(false)
  })

  it('accepts native trigger creation but rejects external secret-creating variants', () => {
    const trigger = {
      triggerSource: 'DEVOPS_CODE_REPOSITORY',
      repositoryId: 'repo',
      actions: [{ type: 'TRIGGER_BUILD_PIPELINE', buildPipelineId: 'pipeline' }],
    }
    expect(
      operationSchemas.create_trigger.safeParse({ ...submission, projectId: 'project', trigger })
        .success
    ).toBe(true)
    expect(
      operationSchemas.create_trigger.safeParse({
        ...submission,
        projectId: 'project',
        trigger: { ...trigger, triggerSource: 'GITHUB' },
      }).success
    ).toBe(false)
  })

  it('rejects legacy Bitbucket Cloud creation and plaintext API credential fields', () => {
    expect(
      operationSchemas.create_connection.safeParse({
        ...submission,
        projectId: 'p',
        connection: {
          connectionType: 'BITBUCKET_CLOUD_APP_PASSWORD',
          appPassword: 'secret',
          username: 'user',
        },
      }).success
    ).toBe(false)
    expect(
      operationSchemas.create_connection.safeParse({
        ...submission,
        projectId: 'p',
        connection: { connectionType: 'GITHUB_ACCESS_TOKEN', accessToken: 'secret' },
      }).success
    ).toBe(false)
  })

  it('bounds native trigger actions and cancellation reasons using operation-specific limits', () => {
    const trigger = {
      triggerSource: 'DEVOPS_CODE_REPOSITORY',
      repositoryId: 'repo',
      actions: Array.from({ length: 21 }, () => ({
        type: 'TRIGGER_BUILD_PIPELINE',
        buildPipelineId: 'pipeline',
      })),
    }
    expect(
      operationSchemas.create_trigger.safeParse({ ...submission, projectId: 'p', trigger }).success
    ).toBe(false)
    const cancellation = { ...submission, ifMatch: 'etag', reason: 'x'.repeat(513) }
    expect(
      operationSchemas.cancel_build_run.safeParse({ ...cancellation, buildRunId: 'run' }).success
    ).toBe(true)
    expect(
      operationSchemas.cancel_deployment.safeParse({ ...cancellation, deploymentId: 'deployment' })
        .success
    ).toBe(false)
  })

  // Static examples from the OCI DevOps 20210630 REST create-stage models.
  it.each([
    {
      deployStagePredecessorCollection: {
        items: [
          {
            id: 'ocid1.resource.oc1..example',
          },
        ],
      },
      deployStageType: 'COMPUTE_INSTANCE_GROUP_BLUE_GREEN_DEPLOYMENT',
      deployEnvironmentIdA: 'example',
      deployEnvironmentIdB: 'example',
      deploymentSpecDeployArtifactId: 'ocid1.resource.oc1..example',
      productionLoadBalancerConfig: {
        listenerName: 'example',
        loadBalancerId: 'ocid1.resource.oc1..example',
      },
      rolloutPolicy: {
        policyType: 'COMPUTE_INSTANCE_GROUP_LINEAR_ROLLOUT_POLICY_BY_COUNT',
        batchCount: 1,
      },
    },
    {
      deployStagePredecessorCollection: {
        items: [
          {
            id: 'ocid1.resource.oc1..example',
          },
        ],
      },
      deployStageType: 'COMPUTE_INSTANCE_GROUP_BLUE_GREEN_TRAFFIC_SHIFT',
      computeInstanceGroupBlueGreenDeploymentDeployStageId: 'ocid1.resource.oc1..example',
    },
    {
      deployStagePredecessorCollection: {
        items: [
          {
            id: 'ocid1.resource.oc1..example',
          },
        ],
      },
      deployStageType: 'COMPUTE_INSTANCE_GROUP_CANARY_APPROVAL',
      approvalPolicy: {
        approvalPolicyType: 'COUNT_BASED_APPROVAL',
        numberOfApprovalsRequired: 1,
      },
      computeInstanceGroupCanaryTrafficShiftDeployStageId: 'ocid1.resource.oc1..example',
    },
    {
      deployStagePredecessorCollection: {
        items: [
          {
            id: 'ocid1.resource.oc1..example',
          },
        ],
      },
      deployStageType: 'COMPUTE_INSTANCE_GROUP_CANARY_DEPLOYMENT',
      computeInstanceGroupDeployEnvironmentId: 'ocid1.resource.oc1..example',
      deploymentSpecDeployArtifactId: 'ocid1.resource.oc1..example',
      productionLoadBalancerConfig: {
        listenerName: 'example',
        loadBalancerId: 'ocid1.resource.oc1..example',
      },
      rolloutPolicy: {
        policyType: 'COMPUTE_INSTANCE_GROUP_LINEAR_ROLLOUT_POLICY_BY_COUNT',
        batchCount: 1,
      },
    },
    {
      deployStagePredecessorCollection: {
        items: [
          {
            id: 'ocid1.resource.oc1..example',
          },
        ],
      },
      deployStageType: 'COMPUTE_INSTANCE_GROUP_CANARY_TRAFFIC_SHIFT',
      computeInstanceGroupCanaryDeployStageId: 'ocid1.resource.oc1..example',
      rolloutPolicy: {
        batchCount: 1,
      },
    },
    {
      deployStagePredecessorCollection: {
        items: [
          {
            id: 'ocid1.resource.oc1..example',
          },
        ],
      },
      deployStageType: 'COMPUTE_INSTANCE_GROUP_ROLLING_DEPLOYMENT',
      computeInstanceGroupDeployEnvironmentId: 'ocid1.resource.oc1..example',
      deploymentSpecDeployArtifactId: 'ocid1.resource.oc1..example',
      rolloutPolicy: {
        policyType: 'COMPUTE_INSTANCE_GROUP_LINEAR_ROLLOUT_POLICY_BY_COUNT',
        batchCount: 1,
      },
    },
    {
      deployStagePredecessorCollection: {
        items: [
          {
            id: 'ocid1.resource.oc1..example',
          },
        ],
      },
      deployStageType: 'DEPLOY_FUNCTION',
      dockerImageDeployArtifactId: 'ocid1.resource.oc1..example',
      functionDeployEnvironmentId: 'ocid1.resource.oc1..example',
    },
    {
      deployStagePredecessorCollection: {
        items: [
          {
            id: 'ocid1.resource.oc1..example',
          },
        ],
      },
      deployStageType: 'INVOKE_FUNCTION',
      functionDeployEnvironmentId: 'ocid1.resource.oc1..example',
      isAsync: false,
      isValidationEnabled: false,
    },
    {
      deployStagePredecessorCollection: {
        items: [
          {
            id: 'ocid1.resource.oc1..example',
          },
        ],
      },
      deployStageType: 'LOAD_BALANCER_TRAFFIC_SHIFT',
      blueBackendIps: {},
      greenBackendIps: {},
      loadBalancerConfig: {
        listenerName: 'example',
        loadBalancerId: 'ocid1.resource.oc1..example',
      },
      rolloutPolicy: {
        batchCount: 1,
      },
      trafficShiftTarget: 'AUTO_SELECT',
    },
    {
      deployStagePredecessorCollection: {
        items: [
          {
            id: 'ocid1.resource.oc1..example',
          },
        ],
      },
      deployStageType: 'MANUAL_APPROVAL',
      approvalPolicy: {
        approvalPolicyType: 'COUNT_BASED_APPROVAL',
        numberOfApprovalsRequired: 1,
      },
    },
    {
      deployStagePredecessorCollection: {
        items: [
          {
            id: 'ocid1.resource.oc1..example',
          },
        ],
      },
      deployStageType: 'OKE_BLUE_GREEN_DEPLOYMENT',
      blueGreenStrategy: {
        strategyType: 'NGINX_BLUE_GREEN_STRATEGY',
        ingressName: 'example',
        namespaceA: 'example',
        namespaceB: 'example',
      },
      kubernetesManifestDeployArtifactIds: ['example'],
      okeClusterDeployEnvironmentId: 'ocid1.resource.oc1..example',
    },
    {
      deployStagePredecessorCollection: {
        items: [
          {
            id: 'ocid1.resource.oc1..example',
          },
        ],
      },
      deployStageType: 'OKE_BLUE_GREEN_TRAFFIC_SHIFT',
      okeBlueGreenDeployStageId: 'ocid1.resource.oc1..example',
    },
    {
      deployStagePredecessorCollection: {
        items: [
          {
            id: 'ocid1.resource.oc1..example',
          },
        ],
      },
      deployStageType: 'OKE_CANARY_APPROVAL',
      approvalPolicy: {
        approvalPolicyType: 'COUNT_BASED_APPROVAL',
        numberOfApprovalsRequired: 1,
      },
      okeCanaryTrafficShiftDeployStageId: 'ocid1.resource.oc1..example',
    },
    {
      deployStagePredecessorCollection: {
        items: [
          {
            id: 'ocid1.resource.oc1..example',
          },
        ],
      },
      deployStageType: 'OKE_CANARY_DEPLOYMENT',
      canaryStrategy: {
        strategyType: 'NGINX_CANARY_STRATEGY',
        ingressName: 'example',
        namespace: 'example',
      },
      kubernetesManifestDeployArtifactIds: ['example'],
      okeClusterDeployEnvironmentId: 'ocid1.resource.oc1..example',
    },
    {
      deployStagePredecessorCollection: {
        items: [
          {
            id: 'ocid1.resource.oc1..example',
          },
        ],
      },
      deployStageType: 'OKE_CANARY_TRAFFIC_SHIFT',
      okeCanaryDeployStageId: 'ocid1.resource.oc1..example',
      rolloutPolicy: {
        batchCount: 1,
      },
    },
    {
      deployStagePredecessorCollection: {
        items: [
          {
            id: 'ocid1.resource.oc1..example',
          },
        ],
      },
      deployStageType: 'OKE_DEPLOYMENT',
      kubernetesManifestDeployArtifactIds: ['example'],
      okeClusterDeployEnvironmentId: 'ocid1.resource.oc1..example',
    },
    {
      deployStagePredecessorCollection: {
        items: [
          {
            id: 'ocid1.resource.oc1..example',
          },
        ],
      },
      deployStageType: 'OKE_HELM_CHART_DEPLOYMENT',
      helmChartDeployArtifactId: 'ocid1.resource.oc1..example',
      okeClusterDeployEnvironmentId: 'ocid1.resource.oc1..example',
      releaseName: 'example',
    },
    {
      deployStagePredecessorCollection: {
        items: [
          {
            id: 'ocid1.resource.oc1..example',
          },
        ],
      },
      deployStageType: 'SHELL',
      commandSpecDeployArtifactId: 'ocid1.resource.oc1..example',
      containerConfig: {
        containerConfigType: 'CONTAINER_INSTANCE_CONFIG',
        networkChannel: {
          networkChannelType: 'PRIVATE_ENDPOINT_CHANNEL',
          subnetId: 'ocid1.resource.oc1..example',
        },
        shapeConfig: {
          ocpus: 1.0,
        },
        shapeName: 'example',
      },
    },
    {
      deployStagePredecessorCollection: {
        items: [
          {
            id: 'ocid1.resource.oc1..example',
          },
        ],
      },
      deployStageType: 'WAIT',
      waitCriteria: {
        waitType: 'ABSOLUTE_WAIT',
        waitDuration: 'PT30S',
      },
    },
  ])('accepts the documented $deployStageType deployment subtype', (stage) => {
    expect(
      operationSchemas.create_deploy_stage.safeParse({
        ...submission,
        deployPipelineId: 'pipeline',
        stage,
      }).success
    ).toBe(true)
  })

  it('retains the documented VBS create/update URL bound asymmetry', () => {
    const connection = {
      connectionType: 'VBS_ACCESS_TOKEN',
      secretId: 'ocid1.vaultsecret.oc1..example',
      baseUrl: `https://example.com/${'x'.repeat(260)}`,
    }
    expect(
      operationSchemas.create_connection.safeParse({
        ...submission,
        projectId: 'project',
        connection,
      }).success
    ).toBe(true)
    expect(
      operationSchemas.update_connection.safeParse({
        ...credential,
        connectionId: 'connection',
        ifMatch: 'etag',
        connection,
      }).success
    ).toBe(false)
  })

  it('rejects mismatched native trigger filter discriminators', () => {
    expect(
      operationSchemas.create_trigger.safeParse({
        ...submission,
        projectId: 'project',
        trigger: {
          triggerSource: 'DEVOPS_CODE_REPOSITORY',
          repositoryId: 'repository',
          actions: [
            {
              type: 'TRIGGER_BUILD_PIPELINE',
              buildPipelineId: 'pipeline',
              filter: { triggerSource: 'GITHUB' },
            },
          ],
        },
      }).success
    ).toBe(false)
  })
})
