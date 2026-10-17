import { filterUndefined } from '@sim/utils/object'
import type {
  DatabricksCreateJobParams,
  DatabricksCreateJobResponse,
} from '@/tools/databricks/types'
import {
  DATABRICKS_AUTH_PARAMS,
  databricksUrl,
  optionalDatabricksString,
  parseDatabricksJson,
  readDatabricksError,
} from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'

export const createJobTool: ToolConfig<DatabricksCreateJobParams, DatabricksCreateJobResponse> = {
  id: 'databricks_create_job',
  name: 'Databricks Create Job',
  description:
    'Create a Databricks job with tasks, scheduling, execution identity, and notifications.',
  version: '1.0.0',
  params: {
    ...DATABRICKS_AUTH_PARAMS,
    accessControlList: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Initial permissions as [{user_name, group_name, service_principal_name, permission_level}]',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Display name of the job',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the job',
    },
    emailNotifications: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email recipients by event, such as {on_failure: ["ops@example.com"]}',
    },
    webhookNotifications: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Notification destination IDs grouped by event',
    },
    notificationSettings: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Notification preferences for skipped runs, canceled runs, and retries',
    },
    timeoutSeconds: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum run duration in seconds; 0 disables the timeout',
    },
    health: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Health rules as {rules: [{metric, op, value}]}',
    },
    schedule: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Quartz schedule as {quartz_cron_expression, timezone_id, pause_status}',
    },
    jobTrigger: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Job trigger settings in Databricks API format',
    },
    continuous: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Continuous execution settings; mutually exclusive with schedule',
    },
    maxConcurrentRuns: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum simultaneous runs allowed for this job',
    },
    tasks: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Task definitions using Databricks API fields, including task_key, depends_on, and notebook_task or other task types',
    },
    jobClusters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Shared job clusters as [{job_cluster_key, new_cluster}]',
    },
    gitSource: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Git repository URL, provider, and branch, tag, or commit',
    },
    tags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Job tags as a JSON object of string keys and values',
    },
    queue: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Queue behavior as {enabled: true} or {enabled: false}',
    },
    parameters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Job parameter definitions as [{name, default}]',
    },
    runAs: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Execution identity as {user_name} or {service_principal_name}',
    },
    editMode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the job can be edited in the Databricks UI',
    },
    deployment: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'External deployment metadata including kind and metadata_file_path',
    },
    environments: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Task environments as [{environment_key, spec}]',
    },
    budgetPolicyId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Serverless budget policy identifier',
    },
    performanceTarget: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Serverless performance mode: STANDARD or PERFORMANCE_OPTIMIZED',
    },
    triggers: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Job trigger definitions; cannot be combined with the singular trigger setting',
    },
    environmentVariables: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Named environment variable definitions in Databricks API format',
    },
    maxRetries: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum retry count; -1 retries indefinitely and 0 disables retries',
    },
    minRetryIntervalMillis: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Minimum time in milliseconds between attempts',
    },
    retryOnTimeout: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether a timed-out run should be retried',
    },
    disableAutoOptimization: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Disable serverless automatic optimization',
    },
  },
  request: {
    url: (params) => databricksUrl(params.host, `/api/2.2/jobs/create`),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      return filterUndefined({
        access_control_list: parseDatabricksJson(
          params.accessControlList,
          'accessControlList',
          'array'
        ),
        name: optionalDatabricksString(params.name),
        description: optionalDatabricksString(params.description),
        email_notifications: parseDatabricksJson(
          params.emailNotifications,
          'emailNotifications',
          'object'
        ),
        webhook_notifications: parseDatabricksJson(
          params.webhookNotifications,
          'webhookNotifications',
          'object'
        ),
        notification_settings: parseDatabricksJson(
          params.notificationSettings,
          'notificationSettings',
          'object'
        ),
        timeout_seconds: params.timeoutSeconds,
        health: parseDatabricksJson(params.health, 'health', 'object'),
        schedule: parseDatabricksJson(params.schedule, 'schedule', 'object'),
        trigger: parseDatabricksJson(params.jobTrigger, 'jobTrigger', 'object'),
        continuous: parseDatabricksJson(params.continuous, 'continuous', 'object'),
        max_concurrent_runs: params.maxConcurrentRuns,
        tasks: parseDatabricksJson(params.tasks, 'tasks', 'array'),
        job_clusters: parseDatabricksJson(params.jobClusters, 'jobClusters', 'array'),
        git_source: parseDatabricksJson(params.gitSource, 'gitSource', 'object'),
        tags: parseDatabricksJson(params.tags, 'tags', 'object'),
        queue: parseDatabricksJson(params.queue, 'queue', 'object'),
        parameters: parseDatabricksJson(params.parameters, 'parameters', 'array'),
        run_as: parseDatabricksJson(params.runAs, 'runAs', 'object'),
        edit_mode: optionalDatabricksString(params.editMode),
        deployment: parseDatabricksJson(params.deployment, 'deployment', 'object'),
        environments: parseDatabricksJson(params.environments, 'environments', 'array'),
        budget_policy_id: optionalDatabricksString(params.budgetPolicyId),
        performance_target: optionalDatabricksString(params.performanceTarget),
        triggers: parseDatabricksJson(params.triggers, 'triggers', 'array'),
        environment_variables: parseDatabricksJson(
          params.environmentVariables,
          'environmentVariables',
          'array'
        ),
        max_retries: params.maxRetries,
        min_retry_interval_millis: params.minRetryIntervalMillis,
        retry_on_timeout: params.retryOnTimeout,
        disable_auto_optimization: params.disableAutoOptimization,
      })
    },
  },
  transformResponse: async (response) => {
    if (!response.ok) throw new Error(await readDatabricksError(response, 'Failed to create job'))
    const data = await response.json()
    return { success: true, output: { jobId: data.job_id ?? null } }
  },
  outputs: {
    jobId: { type: 'number', nullable: true, description: 'Job identifier' },
  },
}
