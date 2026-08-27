import type { GetWorkflowParams, WorkflowResponse } from '@/tools/github/types'
import { WORKFLOW_OUTPUT_PROPERTIES } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'
import { safeOpaqueUrlSegment, safeUrlPathSegment } from '@/tools/url-path'

export const getWorkflowTool: ToolConfig<GetWorkflowParams, WorkflowResponse> = {
  id: 'github_get_workflow',
  name: 'GitHub Get Workflow',
  description:
    'Get details of a specific GitHub Actions workflow by ID or filename. Returns workflow information including name, path, state, and badge URL.',
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
    workflow_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Workflow ID (number) or workflow filename (e.g., "main.yaml")',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub Personal Access Token',
    },
  },

  /**
   * `workflow_id` is opaque, not a single conventional segment.
   *
   * GitHub documents it as "the ID of the workflow. You can also pass the
   * workflow file name as a string" (`components.parameters.workflow-id`), and
   * the file name `github_list_workflows` prints to the model is the
   * repo-relative `.github/workflows/ci.yml` — so a slash-bearing value is the
   * ordinary case, not an attack. `safeUrlPathSegment` rejected every one of
   * them outright; `safeUrlPath` would emit the slashes literally, which misses
   * the route. Verified live against `simstudioai/sim`:
   * `actions/workflows/.github%2Fworkflows%2Fci.yml`, `.../ci.yml`, and
   * `.../150137063` all answer `200`, while `.../.github/workflows/ci.yml`
   * answers `404`. `safeOpaqueUrlSegment` still rejects an exact `.` or `..` and
   * encodes everything else into one inert segment.
   */
  request: {
    url: (params) =>
      `https://api.github.com/repos/${safeUrlPathSegment(params.owner, 'owner')}/${safeUrlPathSegment(params.repo, 'repo')}/actions/workflows/${safeOpaqueUrlSegment(params.workflow_id, 'workflow_id')}`,
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    const content = `Workflow: ${data.name}
State: ${data.state}
Path: ${data.path}
ID: ${data.id}
Badge URL: ${data.badge_url}
Created: ${data.created_at}
Updated: ${data.updated_at}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          id: data.id,
          name: data.name,
          path: data.path,
          state: data.state,
          badge_url: data.badge_url,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable workflow details' },
    metadata: {
      type: 'object',
      description: 'Workflow metadata',
      properties: {
        id: { type: 'number', description: 'Workflow ID' },
        name: { type: 'string', description: 'Workflow name' },
        path: { type: 'string', description: 'Path to workflow file' },
        state: { type: 'string', description: 'Workflow state (active/disabled)' },
        badge_url: { type: 'string', description: 'Badge URL for workflow' },
      },
    },
  },
}

export const getWorkflowV2Tool: ToolConfig<GetWorkflowParams, any> = {
  id: 'github_get_workflow_v2',
  name: getWorkflowTool.name,
  description: getWorkflowTool.description,
  version: '2.0.0',
  params: getWorkflowTool.params,
  request: getWorkflowTool.request,

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        id: data.id,
        node_id: data.node_id,
        name: data.name,
        path: data.path,
        state: data.state,
        html_url: data.html_url,
        badge_url: data.badge_url,
        url: data.url,
        created_at: data.created_at,
        updated_at: data.updated_at,
        deleted_at: data.deleted_at ?? null,
      },
    }
  },

  outputs: {
    ...WORKFLOW_OUTPUT_PROPERTIES,
  },
}
