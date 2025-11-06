import type { RerunWorkflowParams, RerunWorkflowResponse } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const rerunWorkflowTool: ToolConfig<RerunWorkflowParams, RerunWorkflowResponse> = {
  id: 'github_rerun_workflow',
  name: 'GitHub Rerun Workflow',
  description:
    'Rerun a workflow run. Optionally enable debug logging for the rerun. Returns 201 Created on success.',
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
      description: 'Workflow run ID to rerun',
    },
    enable_debug_logging: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Enable debug logging for the rerun (default: false)',
      default: false,
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
      `https://api.github.com/repos/${params.owner}/${params.repo}/actions/runs/${params.run_id}/rerun`,
    method: 'POST',
    headers: (params) => ({
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
    body: (params) => ({
      ...(params.enable_debug_logging !== undefined && {
        enable_debug_logging: params.enable_debug_logging,
      }),
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

    const content = `Workflow run #${params.run_id} has been queued for rerun.${params.enable_debug_logging ? '\nDebug logging is enabled for this rerun.' : ''}
The rerun should start shortly.`

    return {
      success: true,
      output: {
        content,
        metadata: {
          run_id: params.run_id,
          status: 'rerun_initiated',
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Rerun confirmation message' },
    metadata: {
      type: 'object',
      description: 'Rerun metadata',
      properties: {
        run_id: { type: 'number', description: 'Workflow run ID' },
        status: { type: 'string', description: 'Rerun status (rerun_initiated)' },
      },
    },
  },
}
