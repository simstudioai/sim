import { isRecordLike } from '@sim/utils/object'
import { githubPathSegment, githubRepoPath } from '@/tools/github/request-path'
import type { TriggerWorkflowParams, TriggerWorkflowResponse } from '@/tools/github/types'
import { GITHUB_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'

/**
 * GitHub requires `inputs` to be a JSON object, but the block's long-input
 * stores the JSON as text, so a string is parsed here. A model's object passes
 * through unchanged; a blank value sends no inputs.
 */
function toWorkflowInputs(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined
  let parsed: unknown = value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return undefined
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw new Error('Workflow inputs must be a JSON object, such as {"environment":"prod"}')
    }
  }
  if (!isRecordLike(parsed)) {
    throw new Error('Workflow inputs must be a JSON object, such as {"environment":"prod"}')
  }
  return parsed
}

export const triggerWorkflowTool: ToolConfig<TriggerWorkflowParams, TriggerWorkflowResponse> = {
  id: 'github_trigger_workflow',
  name: 'GitHub Trigger Workflow',
  description:
    'Trigger a workflow dispatch event for a GitHub Actions workflow. The workflow must have a workflow_dispatch trigger configured. Returns 204 No Content on success.',
  version: '1.0.0',
  oauth: GITHUB_CREDENTIAL_OAUTH,

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
    workflow_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Workflow ID (number) or workflow filename (e.g., "main.yaml")',
    },
    ref: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Git reference (branch or tag name) to run the workflow on',
    },
    inputs: {
      type: 'object',
      required: false,
      visibility: 'user-or-llm',
      description: 'Input keys and values configured in the workflow file',
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
      `https://api.github.com/repos/${githubRepoPath(params.owner, params.repo)}/actions/workflows/${githubPathSegment(params.workflow_id, 'workflow_id')}/dispatches`,
    method: 'POST',
    headers: (params) => ({
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
    body: (params) => {
      const inputs = toWorkflowInputs(params.inputs)
      return {
        ref: params.ref,
        ...(inputs && { inputs }),
      }
    },
  },

  transformResponse: async (_response, params) => {
    const content = `Workflow dispatched successfully on ref: ${params?.ref ?? 'requested ref'}
The workflow run should start shortly.`

    return {
      success: true,
      output: {
        content,
        metadata: {},
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Confirmation message' },
    metadata: {
      type: 'object',
      description: 'Empty metadata object (204 No Content response)',
    },
  },
}

export const triggerWorkflowV2Tool: ToolConfig = {
  id: 'github_trigger_workflow_v2',
  name: triggerWorkflowTool.name,
  description: triggerWorkflowTool.description,
  version: '2.0.0',
  params: triggerWorkflowTool.params,
  request: triggerWorkflowTool.request,
  oauth: triggerWorkflowTool.oauth,
  transformResponse: async (response: Response, params) => {
    return {
      success: true,
      output: {
        triggered: response.status === 204,
        workflow_id: params?.workflow_id ?? null,
        ref: params?.ref ?? null,
      },
    }
  },
  outputs: {
    triggered: { type: 'boolean', description: 'Whether workflow was triggered' },
    workflow_id: { type: 'string', description: 'Workflow ID or filename', optional: true },
    ref: { type: 'string', description: 'Git reference used', optional: true },
  },
}
