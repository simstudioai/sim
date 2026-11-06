import { filterUndefined } from '@sim/utils/object'
import type {
  DatabricksCreateClusterParams,
  DatabricksCreateClusterResponse,
} from '@/tools/databricks/types'
import {
  DATABRICKS_AUTH_PARAMS,
  databricksUrl,
  optionalDatabricksString,
  parseDatabricksJson,
  readDatabricksError,
} from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'

export const createClusterTool: ToolConfig<
  DatabricksCreateClusterParams,
  DatabricksCreateClusterResponse
> = {
  id: 'databricks_create_cluster',
  name: 'Databricks Create Cluster',
  description:
    'Create a compute cluster with runtime, sizing, policy, and cloud-specific settings.',
  version: '1.0.0',
  params: {
    ...DATABRICKS_AUTH_PARAMS,
    applyPolicyDefaultValues: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Fill unspecified settings from the compute policy defaults',
    },
    cloneFrom: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Clone source as {source_cluster_id, clone_source}',
    },
    numWorkers: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Fixed worker count; use this or autoscale',
    },
    autoscale: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Worker range as {min_workers, max_workers}; use this or numWorkers',
    },
    clusterName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Display name of the compute cluster',
    },
    sparkVersion: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Databricks runtime version, or omit when supplied by a compute policy',
    },
    sparkConf: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Spark configuration as a JSON map',
    },
    awsAttributes: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'AWS compute configuration such as availability, zone_id, and instance_profile_arn',
    },
    azureAttributes: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Azure compute configuration such as availability and spot_bid_max_price',
    },
    gcpAttributes: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'GCP compute configuration such as availability and zone_id',
    },
    nodeTypeId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Worker node type identifier',
    },
    driverNodeTypeId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Driver node type identifier',
    },
    workerNodeTypeFlexibility: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Alternative worker node type selection settings',
    },
    driverNodeTypeFlexibility: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Alternative driver node type selection settings',
    },
    sshPublicKeys: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'SSH public keys to install on the cluster',
    },
    customTags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom cluster tags as a JSON map',
    },
    clusterLogConf: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cluster log destination in Databricks API format',
    },
    sparkEnvVars: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Environment variables for the Spark processes as a JSON map',
    },
    autoterminationMinutes: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Idle minutes before termination; 0 disables automatic termination',
    },
    enableElasticDisk: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Allow automatic expansion of attached storage',
    },
    initScripts: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cluster initialization script locations in Databricks API format',
    },
    dockerImage: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom container image URL and optional basic_auth settings',
    },
    instancePoolId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Worker instance pool identifier',
    },
    singleUserName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Assigned user or service principal for dedicated access mode',
    },
    policyId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Compute policy identifier',
    },
    enableLocalDiskEncryption: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Encrypt local cluster storage',
    },
    driverInstancePoolId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Driver instance pool identifier',
    },
    workloadType: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Permitted workload types in Databricks API format',
    },
    dataSecurityMode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cluster access mode',
    },
    runtimeEngine: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Runtime execution engine',
    },
    kind: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Compute kind',
    },
    useMlRuntime: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Use a machine learning runtime',
    },
    isSingleNode: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Create a single-node compute resource',
    },
    remoteDiskThroughput: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Remote disk throughput setting',
    },
    totalInitialRemoteDiskSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Initial remote disk size setting',
    },
    dependencyMode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cluster dependency mode',
    },
  },
  request: {
    url: (params) => databricksUrl(params.host, `/api/2.1/clusters/create`),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      return filterUndefined({
        apply_policy_default_values: params.applyPolicyDefaultValues,
        clone_from: parseDatabricksJson(params.cloneFrom, 'cloneFrom', 'object'),
        num_workers: params.numWorkers,
        autoscale: parseDatabricksJson(params.autoscale, 'autoscale', 'object'),
        cluster_name: optionalDatabricksString(params.clusterName),
        spark_version: optionalDatabricksString(params.sparkVersion),
        spark_conf: parseDatabricksJson(params.sparkConf, 'sparkConf', 'object'),
        aws_attributes: parseDatabricksJson(params.awsAttributes, 'awsAttributes', 'object'),
        azure_attributes: parseDatabricksJson(params.azureAttributes, 'azureAttributes', 'object'),
        gcp_attributes: parseDatabricksJson(params.gcpAttributes, 'gcpAttributes', 'object'),
        node_type_id: optionalDatabricksString(params.nodeTypeId),
        driver_node_type_id: optionalDatabricksString(params.driverNodeTypeId),
        worker_node_type_flexibility: parseDatabricksJson(
          params.workerNodeTypeFlexibility,
          'workerNodeTypeFlexibility',
          'object'
        ),
        driver_node_type_flexibility: parseDatabricksJson(
          params.driverNodeTypeFlexibility,
          'driverNodeTypeFlexibility',
          'object'
        ),
        ssh_public_keys: parseDatabricksJson(params.sshPublicKeys, 'sshPublicKeys', 'array'),
        custom_tags: parseDatabricksJson(params.customTags, 'customTags', 'object'),
        cluster_log_conf: parseDatabricksJson(params.clusterLogConf, 'clusterLogConf', 'object'),
        spark_env_vars: parseDatabricksJson(params.sparkEnvVars, 'sparkEnvVars', 'object'),
        autotermination_minutes: params.autoterminationMinutes,
        enable_elastic_disk: params.enableElasticDisk,
        init_scripts: parseDatabricksJson(params.initScripts, 'initScripts', 'array'),
        docker_image: parseDatabricksJson(params.dockerImage, 'dockerImage', 'object'),
        instance_pool_id: optionalDatabricksString(params.instancePoolId),
        single_user_name: optionalDatabricksString(params.singleUserName),
        policy_id: optionalDatabricksString(params.policyId),
        enable_local_disk_encryption: params.enableLocalDiskEncryption,
        driver_instance_pool_id: optionalDatabricksString(params.driverInstancePoolId),
        workload_type: parseDatabricksJson(params.workloadType, 'workloadType', 'object'),
        data_security_mode: optionalDatabricksString(params.dataSecurityMode),
        runtime_engine: optionalDatabricksString(params.runtimeEngine),
        kind: optionalDatabricksString(params.kind),
        use_ml_runtime: params.useMlRuntime,
        is_single_node: params.isSingleNode,
        remote_disk_throughput: params.remoteDiskThroughput,
        total_initial_remote_disk_size: params.totalInitialRemoteDiskSize,
        dependency_mode: optionalDatabricksString(params.dependencyMode),
      })
    },
  },
  transformResponse: async (response) => {
    if (!response.ok)
      throw new Error(await readDatabricksError(response, 'Failed to create cluster'))
    const data = await response.json()
    return { success: true, output: { clusterId: data.cluster_id ?? null } }
  },
  outputs: {
    clusterId: { type: 'string', nullable: true, description: 'Compute cluster identifier' },
  },
}
