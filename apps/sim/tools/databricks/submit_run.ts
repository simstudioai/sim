import { filterUndefined } from '@sim/utils/object'
import type {
  DatabricksSubmitRunParams,
  DatabricksSubmitRunResponse,
} from '@/tools/databricks/types'
import {
  DATABRICKS_AUTH_PARAMS,
  databricksUrl,
  optionalDatabricksString,
  parseDatabricksJson,
  readDatabricksError,
} from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'

export const submitRunTool: ToolConfig<DatabricksSubmitRunParams, DatabricksSubmitRunResponse> = {
  id: 'databricks_submit_run',
  name: 'Databricks Submit Run',
  description: 'Submit a one-time task run without creating a saved job.',
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
    queue: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Queue behavior as {enabled: true} or {enabled: false}',
    },
    runAs: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Execution identity as {user_name} or {service_principal_name}',
    },
    runName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Display name of the one-time run',
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
    idempotencyToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Retry token that prevents duplicate runs; at most 64 characters',
    },
    tasks: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Task definitions using Databricks API fields, including task_key, depends_on, and notebook_task or other task types',
    },
    gitSource: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Git repository URL, provider, and branch, tag, or commit',
    },
    webhookNotifications: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Notification destination IDs grouped by event',
    },
    emailNotifications: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email recipients by event, such as {on_failure: ["ops@example.com"]}',
    },
    notificationSettings: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Notification preferences for skipped runs, canceled runs, and retries',
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
    environmentVariables: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Named environment variable definitions in Databricks API format',
    },
    performanceTarget: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Serverless performance mode: STANDARD or PERFORMANCE_OPTIMIZED',
    },
  },
  request: {
    url: (params) => databricksUrl(params.host, `/api/2.2/jobs/runs/submit`),
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
        queue: parseDatabricksJson(params.queue, 'queue', 'object'),
        run_as: parseDatabricksJson(params.runAs, 'runAs', 'object'),
        run_name: optionalDatabricksString(params.runName),
        timeout_seconds: params.timeoutSeconds,
        health: parseDatabricksJson(params.health, 'health', 'object'),
        idempotency_token: optionalDatabricksString(params.idempotencyToken),
        tasks: parseDatabricksJson(params.tasks, 'tasks', 'array'),
        git_source: parseDatabricksJson(params.gitSource, 'gitSource', 'object'),
        webhook_notifications: parseDatabricksJson(
          params.webhookNotifications,
          'webhookNotifications',
          'object'
        ),
        email_notifications: parseDatabricksJson(
          params.emailNotifications,
          'emailNotifications',
          'object'
        ),
        notification_settings: parseDatabricksJson(
          params.notificationSettings,
          'notificationSettings',
          'object'
        ),
        environments: parseDatabricksJson(params.environments, 'environments', 'array'),
        budget_policy_id: optionalDatabricksString(params.budgetPolicyId),
        environment_variables: parseDatabricksJson(
          params.environmentVariables,
          'environmentVariables',
          'array'
        ),
        performance_target: optionalDatabricksString(params.performanceTarget),
      })
    },
  },
  transformResponse: async (response) => {
    if (!response.ok) throw new Error(await readDatabricksError(response, 'Failed to submit run'))
    const data = await response.json()
    return { success: true, output: { runId: data.run_id ?? null } }
  },
  outputs: {
    runId: { type: 'number', nullable: true, description: 'Run identifier' },
  },
}
