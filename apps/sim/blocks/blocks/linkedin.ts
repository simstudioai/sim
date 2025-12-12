import { LinkedInIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { LinkedInResponse } from '@/tools/linkedin/types'

export const LinkedInBlock: BlockConfig<LinkedInResponse> = {
  type: 'linkedin',
  name: 'LinkedIn',
  description: 'Share posts and manage your LinkedIn presence',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate LinkedIn into workflows. Share posts to your personal feed and access your LinkedIn profile information.',
  docsLink: 'https://docs.sim.ai/tools/linkedin',
  category: 'tools',
  bgColor: '#0072B1',
  icon: LinkedInIcon,
  subBlocks: [
    // Operation selection
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Share Post', id: 'share_post' },
        { label: 'Get Profile', id: 'get_profile' },
      ],
      value: () => 'share_post',
    },

    // LinkedIn OAuth Authentication
    {
      id: 'credential',
      title: 'LinkedIn Account',
      type: 'oauth-input',
      serviceId: 'linkedin',
      requiredScopes: ['profile', 'openid', 'email', 'w_member_social'],
      placeholder: 'Select LinkedIn account',
      required: true,
    },

    // Share Post specific fields
    {
      id: 'text',
      title: 'Post Text',
      type: 'long-input',
      placeholder: 'What do you want to share on LinkedIn?',
      condition: {
        field: 'operation',
        value: 'share_post',
      },
      required: true,
    },
    {
      id: 'visibility',
      title: 'Visibility',
      type: 'dropdown',
      options: [
        { label: 'Public', id: 'PUBLIC' },
        { label: 'Connections Only', id: 'CONNECTIONS' },
      ],
      condition: {
        field: 'operation',
        value: 'share_post',
      },
      value: () => 'PUBLIC',
      required: true,
    },
  ],
  tools: {
    access: ['linkedin_share_post', 'linkedin_get_profile'],
    config: {
      tool: (inputs) => {
        const operation = inputs.operation || 'share_post'

        if (operation === 'get_profile') {
          return 'linkedin_get_profile'
        }

        return 'linkedin_share_post'
      },
      params: (inputs) => {
        const operation = inputs.operation || 'share_post'
        const { credential, ...rest } = inputs

        if (operation === 'get_profile') {
          return {
            accessToken: credential,
          }
        }

        return {
          text: rest.text,
          visibility: rest.visibility || 'PUBLIC',
          accessToken: credential,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'LinkedIn access token' },
    text: { type: 'string', description: 'Post text content' },
    visibility: { type: 'string', description: 'Post visibility (PUBLIC or CONNECTIONS)' },
  },
  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    postId: { type: 'string', description: 'Created post ID' },
    profile: { type: 'json', description: 'LinkedIn profile information' },
    error: { type: 'string', description: 'Error message if operation failed' },
  },
}
