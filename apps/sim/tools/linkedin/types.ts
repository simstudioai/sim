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
