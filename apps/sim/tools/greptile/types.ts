import type { ToolResponse } from '@/tools/types'

/**
 * Common parameters for all Greptile tools
 */
export interface GreptileBaseParams {
  apiKey: string
  githubToken: string
}

/**
 * Repository identifier format
 */
export interface GreptileRepository {
  remote: 'github' | 'gitlab'
  branch: string
  repository: string
}

/**
 * Query tool parameters
 */
export interface GreptileQueryParams extends GreptileBaseParams {
  query: string
  repositories: string
  sessionId?: string
  stream?: boolean
  genius?: boolean
}

/**
 * Source reference in query/search results
 */
export interface GreptileSource {
  repository: string
  remote: string
  branch: string
  filepath: string
  linestart?: number
  lineend?: number
  summary?: string
  distance?: number
}

/**
 * Query response
 */
export interface GreptileQueryResponse extends ToolResponse {
  output: {
    message: string
    sources: GreptileSource[]
  }
}

/**
 * Search tool parameters
 */
export interface GreptileSearchParams extends GreptileBaseParams {
  query: string
  repositories: string
  sessionId?: string
  genius?: boolean
}

/**
 * Search response
 */
export interface GreptileSearchResponse extends ToolResponse {
  output: {
    sources: GreptileSource[]
  }
}

/**
 * Index repository tool parameters
 */
export interface GreptileIndexParams extends GreptileBaseParams {
  remote: 'github' | 'gitlab'
  repository: string
  branch: string
  reload?: boolean
  notify?: boolean
}

/**
 * Index repository response
 */
export interface GreptileIndexResponse extends ToolResponse {
  output: {
    repositoryId: string
    statusEndpoint: string
    message: string
  }
}

/**
 * Get repository status tool parameters
 */
export interface GreptileStatusParams extends GreptileBaseParams {
  remote: 'github' | 'gitlab'
  repository: string
  branch: string
}

/**
 * Repository status response
 */
export interface GreptileStatusResponse extends ToolResponse {
  output: {
    repository: string
    remote: string
    branch: string
    private: boolean
    status: 'submitted' | 'cloning' | 'processing' | 'completed' | 'failed'
    filesProcessed?: number
    numFiles?: number
    sampleQuestions?: string[]
    sha?: string
  }
}

/**
 * Union type for all Greptile responses
 */
export type GreptileResponse =
  | GreptileQueryResponse
  | GreptileSearchResponse
  | GreptileIndexResponse
  | GreptileStatusResponse
