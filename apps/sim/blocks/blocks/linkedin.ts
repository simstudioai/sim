import { LinkedInIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
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
  integrationType: IntegrationType.Sales,
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
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      requiredScopes: getScopesForService('linkedin'),
      placeholder: 'Select LinkedIn account',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'LinkedIn Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
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
        const { oauthCredential, ...rest } = inputs

        if (operation === 'get_profile') {
          return {
            accessToken: oauthCredential,
          }
        }

        return {
          text: rest.text,
          visibility: rest.visibility || 'PUBLIC',
          accessToken: oauthCredential,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'LinkedIn access token' },
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

export const LinkedInBlockMeta = {
  tags: ['marketing', 'sales-engagement', 'enrichment'],
  templates: [
    {
      icon: LinkedInIcon,
      title: 'LinkedIn content engine',
      prompt:
        'Build a workflow that scrapes my company blog for new posts, generates LinkedIn posts with hooks, insights, and calls-to-action optimized for engagement, and saves drafts as files for my review before posting to LinkedIn.',
      modules: ['agent', 'files', 'scheduled', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content', 'automation'],
    },
    {
      icon: LinkedInIcon,
      title: 'LinkedIn engagement tracker',
      prompt:
        'Build a scheduled workflow that monitors LinkedIn engagement on the company posts, identifies high-influence engagers, and writes them to a sales-prospect table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'marketing'],
    },
    {
      icon: LinkedInIcon,
      title: 'LinkedIn account intel',
      prompt:
        'Create a workflow that for a tracked account scrapes LinkedIn for recent hires, leadership changes, and posts, then writes the intel to the matching CRM account.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: LinkedInIcon,
      title: 'LinkedIn job-change alerter',
      prompt:
        'Build a workflow that watches LinkedIn job-change signals for CRM contacts, posts a Slack alert to the rep when a key contact moves, and updates HubSpot.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'monitoring'],
      alsoIntegrations: ['slack', 'hubspot'],
    },
    {
      icon: LinkedInIcon,
      title: 'LinkedIn content scheduler',
      prompt:
        'Create a workflow that reads a tables-based LinkedIn content calendar, posts each entry at the scheduled time, and writes the post URL back to the row.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation'],
    },
    {
      icon: LinkedInIcon,
      title: 'Blog-to-LinkedIn repurposer',
      prompt:
        'Build a workflow that on a newly published blog post drafts a punchy LinkedIn post summarizing the key insight with an agent, shares it to my LinkedIn profile, and logs the post URL to a content table for tracking.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content', 'automation'],
    },
    {
      icon: LinkedInIcon,
      title: 'LinkedIn profile enrichment',
      prompt:
        'Create a workflow that on a new lead fetches the LinkedIn profile, extracts role, company, and background, and writes the enriched details back to the CRM record so reps open every conversation with full context.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'enrichment'],
    },
  ],
} as const satisfies BlockMeta
