import type { ToolResponse } from '@/tools/types'

// Tool-specific type definitions
export interface LinkedInProfileOutput {
  profile?: {
    id: string
    name?: string
    email?: string
    picture?: string
  }
  sub?: string
  id?: string
  [key: string]: unknown
}

export interface SharePostParams {
  accessToken: string
  text: string
  visibility?: 'PUBLIC' | 'CONNECTIONS' | 'LOGGED_IN'
  mediaUrls?: string
}

export interface SharePostResponse extends ToolResponse {
  output: {
    postId?: string
    postUrl?: string
    visibility?: string
  }
}

export interface GetProfileParams {
  accessToken: string
}

export interface GetProfileResponse extends ToolResponse {
  output: LinkedInProfileOutput
}

export type ProfileIdExtractor = (output: unknown) => string | null
