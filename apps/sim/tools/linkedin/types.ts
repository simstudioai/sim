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
  /**
   * `com.linkedin.ugc.MemberNetworkVisibility`. The UGC Post API reference documents four values —
   * `PUBLIC`, `CONNECTIONS`, `LOGGED_IN` and `CONTAINER`. `CONTAINER` is deliberately excluded:
   * it delegates visibility to the owner of a container entity (a LinkedIn Group, for example),
   * and this tool posts as `urn:li:person:` with no `containerEntity` on the body, so there is
   * nothing for LinkedIn to delegate to.
   */
  visibility?: 'PUBLIC' | 'CONNECTIONS' | 'LOGGED_IN'
}

export interface SharePostResponse extends ToolResponse {
  output: {
    /**
     * The URN of the created post, from the `x-restli-id` response header; absent if LinkedIn
     * omits the header. LinkedIn documents the create response's `x-restli-id` as carrying the
     * ugcPost id. It is not a guarantee about every id `/v2/ugcPosts` ever hands back: the
     * finder examples in the same reference return `urn:li:share:` ids for existing posts, so
     * the value is reported as received rather than assumed to be a `urn:li:ugcPost:` URN.
     */
    postId?: string
    /**
     * LinkedIn's `feed/update/<urn>` permalink for the created post. LinkedIn documents this URL
     * as viewable by an authorized member, so it is not guaranteed to resolve for the public or
     * for signed-out visitors. Absent whenever {@link SharePostResponse.output.postId} is, and
     * also when `postId` is present but is not shaped like a `urn:li:` URN — the header is
     * server-controlled, so it is only interpolated into a URL after that check.
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
