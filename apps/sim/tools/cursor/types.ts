import type { ToolResponse } from '@/tools/types'

export interface BaseCursorParams {
  apiKey: string
}

export interface ListAgentsParams extends BaseCursorParams {
  limit?: number
  cursor?: string
}

export interface GetAgentParams extends BaseCursorParams {
  agentId: string
}

export interface GetConversationParams extends BaseCursorParams {
  agentId: string
}

export interface LaunchAgentParams extends BaseCursorParams {
  repository: string
  ref?: string
  promptText: string
  promptImages?: string
  model?: string
  branchName?: string
  autoCreatePr?: boolean
  openAsCursorGithubApp?: boolean
  skipReviewerRequest?: boolean
}

export interface AddFollowupParams extends BaseCursorParams {
  agentId: string
  followupPromptText: string
  promptImages?: string
}

export interface StopAgentParams extends BaseCursorParams {
  agentId: string
}

export interface DeleteAgentParams extends BaseCursorParams {
  agentId: string
}

interface AgentSource {
  repository: string
  ref: string
}

interface AgentTarget {
  branchName: string
  url: string
  prUrl?: string
  autoCreatePr: boolean
  openAsCursorGithubApp: boolean
  skipReviewerRequest: boolean
}

interface AgentMetadata {
  id: string
  name: string
  status: 'RUNNING' | 'FINISHED' | 'STOPPED' | 'FAILED'
  source: AgentSource
  target: AgentTarget
  summary?: string
  createdAt: string
}

interface ConversationMessage {
  id: string
  type: 'user_message' | 'assistant_message'
  text: string
}

interface RepositoryMetadata {
  owner: string
  name: string
  repository: string
}

interface ApiKeyInfoMetadata {
  apiKeyName: string
  createdAt: string
  userEmail: string
}

export interface ListAgentsResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      agents: AgentMetadata[]
      nextCursor?: string
    }
  }
}

export interface GetAgentResponse extends ToolResponse {
  output: {
    content: string
    metadata: AgentMetadata
  }
}

export interface GetConversationResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      id: string
      messages: ConversationMessage[]
    }
  }
}

export interface LaunchAgentResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      id: string
      url: string
    }
  }
}

export interface AddFollowupResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      id: string
    }
  }
}

export interface StopAgentResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      id: string
    }
  }
}

export interface DeleteAgentResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      id: string
    }
  }
}

export interface GetApiKeyInfoResponse extends ToolResponse {
  output: {
    content: string
    metadata: ApiKeyInfoMetadata
  }
}

export interface ListModelsResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      models: string[]
    }
  }
}

export interface ListRepositoriesResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      repositories: RepositoryMetadata[]
    }
  }
}

export type CursorResponse =
  | ListAgentsResponse
  | GetAgentResponse
  | GetConversationResponse
  | LaunchAgentResponse
  | AddFollowupResponse
  | StopAgentResponse
  | DeleteAgentResponse
  | GetApiKeyInfoResponse
  | ListModelsResponse
  | ListRepositoriesResponse
