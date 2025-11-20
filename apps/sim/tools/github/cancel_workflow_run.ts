import type { CancelWorkflowRunParams, CancelWorkflowRunResponse } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const cancelWorkflowRunTool: ToolConfig<CancelWorkflowRunParams, CancelWorkflowRunResponse> =
  {
    id: 'github_cancel_workflow_run',
    name: 'GitHub Cancel Workflow Run',
    description:
      'Cancel a workflow run. Returns 202 Accepted if cancellation is initiated, or 409 Conflict if the run cannot be cancelled (already completed).',
    version: '1.0.0',

    params: {
      owner: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Repository owner (user or organization)',
      },
      repo: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Repository name',
      },
      run_id: {
        type: 'number',
        required: true,
        visibility: 'user-or-llm',
        description: 'Workflow run ID to cancel',
      },
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'GitHub Personal Access Token',
      },
    },

    request: {
      url: (params) =>
        `https://api.github.com/repos/${params.owner}/${params.repo}/actions/runs/${params.run_id}/cancel`,
      method: 'POST',
      headers: (params) => ({
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${params.apiKey}`,
        'X-GitHub-Api-Version': '2022-11-28',
      }),
    },

    transformResponse: async (response, params) => {
      if (!params) {
        return {
          success: false,
          error: 'Missing parameters',
          output: {
            content: '',
            metadata: {
              run_id: 0,
              status: 'error',
            },
          },
        }
      }

      if (response.status === 202) {
        const content = `Workflow run #${params.run_id} cancellation initiated successfully.
The run will be cancelled shortly.`

        return {
          success: true,
          output: {
            content,
            metadata: {
              run_id: params.run_id,
              status: 'cancellation_initiated',
            },
          },
        }
      }
      if (response.status === 409) {
        const content = `Cannot cancel workflow run #${params.run_id}.
The run may have already completed or been cancelled.`

        return {
          success: false,
          output: {
            content,
            metadata: {
              run_id: params.run_id,
              status: 'cannot_cancel',
            },
          },
        }
      }

      const content = `Workflow run #${params.run_id} cancellation request processed.`

      return {
        success: true,
        output: {
          content,
          metadata: {
            run_id: params.run_id,
            status: 'processed',
          },
        },
      }
    },

    outputs: {
      content: { type: 'string', description: 'Cancellation status message' },
      metadata: {
        type: 'object',
        description: 'Cancellation metadata',
        properties: {
          run_id: { type: 'number', description: 'Workflow run ID' },
          status: {
            type: 'string',
            description: 'Cancellation status (cancellation_initiated, cannot_cancel, processed)',
          },
        },
      },
    },
  }
