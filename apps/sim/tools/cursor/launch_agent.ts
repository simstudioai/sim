import type { LaunchAgentParams, LaunchAgentResponse } from '@/tools/cursor/types'
import type { ToolConfig } from '@/tools/types'

const launchAgentBase = {
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cursor API key',
    },
    repository: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'GitHub repository URL (e.g., https://github.com/your-org/your-repo)',
    },
    ref: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Branch, tag, or commit to work from (defaults to default branch)',
    },
    promptText: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The instruction text for the agent',
    },
    promptImages: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of image objects with base64 data and dimensions',
    },
    model: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Model to use (leave empty for auto-selection)',
    },
    branchName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom branch name for the agent to use',
    },
    autoCreatePr: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Automatically create a PR when the agent finishes',
    },
    openAsCursorGithubApp: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Open the PR as the Cursor GitHub App',
    },
    skipReviewerRequest: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Skip requesting reviewers on the PR',
    },
  },
  request: {
    url: () => 'https://api.cursor.com/v0/agents',
    method: 'POST',
    headers: (params: LaunchAgentParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${params.apiKey}:`).toString('base64')}`,
    }),
    body: (params: LaunchAgentParams) => {
      const body: Record<string, any> = {
        source: {
          repository: params.repository,
        },
        prompt: {
          text: params.promptText,
        },
      }

      if (params.ref) {
        body.source.ref = params.ref
      }

      if (params.promptImages) {
        try {
          body.prompt.images = JSON.parse(params.promptImages)
        } catch {
          body.prompt.images = []
        }
      }

      if (params.model) {
        body.model = params.model
      }

      const target: Record<string, any> = {}
      if (params.branchName) target.branchName = params.branchName
      if (typeof params.autoCreatePr === 'boolean') target.autoCreatePr = params.autoCreatePr
      if (typeof params.openAsCursorGithubApp === 'boolean')
        target.openAsCursorGithubApp = params.openAsCursorGithubApp
      if (typeof params.skipReviewerRequest === 'boolean')
        target.skipReviewerRequest = params.skipReviewerRequest

      if (Object.keys(target).length > 0) {
        body.target = target
      }

      return body
    },
  },
} satisfies Pick<ToolConfig<LaunchAgentParams, any>, 'params' | 'request'>

export const launchAgentTool: ToolConfig<LaunchAgentParams, LaunchAgentResponse> = {
  id: 'cursor_launch_agent',
  name: 'Cursor Launch Agent',
  description:
    'Start a new cloud agent to work on a GitHub repository with the given instructions.',
  version: '1.0.0',

  ...launchAgentBase,

  transformResponse: async (response) => {
    const data = await response.json()
    const agentUrl = `https://cursor.com/agents?selectedBcId=${data.id}`

    return {
      success: true,
      output: {
        content: 'Agent launched successfully!',
        metadata: {
          id: data.id,
          url: agentUrl,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Success message with agent details' },
    metadata: {
      type: 'object',
      description: 'Launch result metadata',
      properties: {
        id: { type: 'string', description: 'Agent ID' },
        url: { type: 'string', description: 'Agent URL' },
      },
    },
  },
}

interface LaunchAgentV2Response {
  success: boolean
  output: {
    id: string
    url: string
  }
}

export const launchAgentV2Tool: ToolConfig<LaunchAgentParams, LaunchAgentV2Response> = {
  ...launchAgentBase,
  id: 'cursor_launch_agent_v2',
  name: 'Cursor Launch Agent',
  description:
    'Start a new cloud agent to work on a GitHub repository with the given instructions. Returns API-aligned fields only.',
  version: '2.0.0',
  transformResponse: async (response) => {
    const data = await response.json()
    const agentUrl = `https://cursor.com/agents?selectedBcId=${data.id}`

    return {
      success: true,
      output: {
        id: data.id,
        url: agentUrl,
      },
    }
  },
  outputs: {
    id: { type: 'string', description: 'Agent ID' },
    url: { type: 'string', description: 'Agent URL' },
  },
}
