import type { ToolResponse } from '@/tools/types'

export interface LinkedInProfile {
  sub: string
  name: string
  given_name: string
  family_name: string
  email?: string
  picture?: string
  email_verified?: boolean
}

export interface LinkedInPost {
  author: string // URN format: urn:li:person:abc123
  lifecycleState: 'PUBLISHED'
  specificContent: {
    'com.linkedin.ugc.ShareContent': {
      shareCommentary: {
        text: string
      }
      shareMediaCategory: 'NONE' | 'ARTICLE' | 'IMAGE'
      media?: Array<{
        status: 'READY'
        description: {
          text: string
        }
        media: string // URN format
        title: {
          text: string
        }
      }>
    }
  }
  visibility: {
    'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' | 'CONNECTIONS'
  }
}

export type LinkedInResponse = {
  success: boolean
  output: {
    postId?: string
    profile?: {
      id: string
      name: string
      email?: string
      picture?: string
    }
  }
  error?: string
}

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
