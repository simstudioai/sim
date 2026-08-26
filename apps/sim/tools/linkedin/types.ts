import type { ToolResponse } from '@/tools/types'

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
}

export interface SharePostResponse extends ToolResponse {
  output: {
    /** Share URN from the `x-restli-id` response header; absent if LinkedIn omits the header. */
    postId?: string
    /**
     * LinkedIn's `feed/update/<urn>` permalink for the created post. LinkedIn documents this URL
     * as viewable by an authorized member, so it is not guaranteed to resolve for the public or
     * for signed-out visitors. Absent whenever {@link SharePostResponse.output.postId} is.
     */
    postUrl?: string
  }
}

export interface GetProfileParams {
  accessToken: string
}

export interface GetProfileResponse extends ToolResponse {
  output: LinkedInProfileOutput
}

export type ProfileIdExtractor = (output: unknown) => string | null
