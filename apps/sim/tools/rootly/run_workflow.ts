import type { RootlyRunWorkflowParams, RootlyRunWorkflowResponse } from '@/tools/rootly/types'
import type { ToolConfig } from '@/tools/types'

export const rootlyRunWorkflowTool: ToolConfig<RootlyRunWorkflowParams, RootlyRunWorkflowResponse> =
  {
    id: 'rootly_run_workflow',
    name: 'Rootly Run Workflow',
    description: 'Trigger a Rootly automation workflow, optionally scoped to an incident or alert.',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Rootly API key',
      },
      workflowId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The ID of the workflow to run',
      },
      incidentId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Incident ID to run the workflow against',
      },
      alertId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Alert ID to run the workflow against',
      },
      immediate: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Run immediately (true) or respect the workflow wait time (false). Default true',
      },
      checkConditions: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Whether to evaluate the workflow conditions before running. Default false',
      },
    },

    request: {
      url: (params) =>
        `https://api.rootly.com/v1/workflows/${params.workflowId.trim()}/workflow_runs`,
      method: 'POST',
      headers: (params) => ({
        'Content-Type': 'application/vnd.api+json',
        Authorization: `Bearer ${params.apiKey}`,
      }),
      body: (params) => {
        const attributes: Record<string, unknown> = {}
        if (params.incidentId) attributes.incident_id = params.incidentId.trim()
        if (params.alertId) attributes.alert_id = params.alertId.trim()
        if (params.immediate !== undefined) attributes.immediate = params.immediate
        if (params.checkConditions !== undefined)
          attributes.check_conditions = params.checkConditions
        return { data: { type: 'workflow_runs', attributes } }
      },
    },

    transformResponse: async (response: Response) => {
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: { workflowRun: {} as RootlyRunWorkflowResponse['output']['workflowRun'] },
          error: errorData.errors?.[0]?.detail || `HTTP ${response.status}: ${response.statusText}`,
        }
      }

      const data = await response.json()
      const attrs = data.data?.attributes || {}
      return {
        success: true,
        output: {
          workflowRun: {
            id: data.data?.id ?? null,
            workflowId: attrs.workflow_id ?? null,
            status: attrs.status ?? null,
            statusMessage: attrs.status_message ?? null,
            triggeredBy: attrs.triggered_by ?? null,
            incidentId: attrs.incident_id ?? null,
            alertId: attrs.alert_id ?? null,
            startedAt: attrs.started_at ?? null,
            completedAt: attrs.completed_at ?? null,
            failedAt: attrs.failed_at ?? null,
            canceledAt: attrs.canceled_at ?? null,
          },
        },
      }
    },

    outputs: {
      workflowRun: {
        type: 'object',
        description: 'The triggered workflow run',
        properties: {
          id: { type: 'string', description: 'Unique workflow run ID' },
          workflowId: { type: 'string', description: 'ID of the workflow that ran' },
          status: {
            type: 'string',
            description:
              'Run status (queued, started, completed, completed_with_errors, failed, canceled)',
          },
          statusMessage: { type: 'string', description: 'Status detail message' },
          triggeredBy: {
            type: 'string',
            description: 'What triggered the run (system, user, workflow)',
          },
          incidentId: { type: 'string', description: 'Associated incident ID' },
          alertId: { type: 'string', description: 'Associated alert ID' },
          startedAt: { type: 'string', description: 'When the run started' },
          completedAt: { type: 'string', description: 'When the run completed' },
          failedAt: { type: 'string', description: 'When the run failed' },
          canceledAt: { type: 'string', description: 'When the run was canceled' },
        },
      },
    },
  }
