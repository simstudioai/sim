import { LinkedInIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import { LinkedInBlockDisplay } from '@/blocks/blocks/linkedin.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { LinkedInResponse } from '@/tools/linkedin/types'

export const LinkedInBlock: BlockConfig<LinkedInResponse> = {
  ...LinkedInBlockDisplay,
  authMode: AuthMode.OAuth,
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
  tags: ['marketing', 'sales-engagement'],
  url: 'https://www.linkedin.com',
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
      title: 'LinkedIn news-to-post writer',
      prompt:
        'Build a scheduled workflow that searches the web for news in my industry, drafts a short take with a hook and a call-to-action for each top story, and shares the best one to my LinkedIn feed.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content'],
    },
    {
      icon: LinkedInIcon,
      title: 'LinkedIn launch announcer',
      prompt:
        'Create a workflow that on a launch trigger from a table drafts a LinkedIn announcement post with the key details and a link, shares it to my LinkedIn feed, and marks the row as posted.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content', 'automation'],
    },
    {
      icon: LinkedInIcon,
      title: 'LinkedIn weekly recap poster',
      prompt:
        'Build a scheduled weekly workflow that summarizes the week’s wins from a table, drafts a recap post with an agent, and shares it to my LinkedIn feed.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content', 'automation'],
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
      title: 'LinkedIn thought-leadership cadence',
      prompt:
        'Create a scheduled workflow that picks the next idea from a content table, expands it into a full LinkedIn post with an agent, shares it to my LinkedIn feed, and logs the publish time back to the row.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content', 'automation'],
    },
  ],
  skills: [
    {
      name: 'publish-linkedin-post',
      description:
        'Draft and share a post to your LinkedIn feed with a hook, value, and a clear call-to-action.',
      content:
        '# Publish LinkedIn Post\n\nWrite and publish an engagement-optimized post to your LinkedIn feed.\n\n## Steps\n1. Take the source idea, article, or update to post about.\n2. Draft post text with a strong first-line hook, two to three lines of value or insight, and a clear call-to-action, kept within LinkedIn length limits.\n3. Share Post with the drafted text and a visibility of PUBLIC or CONNECTIONS.\n\n## Output\nConfirmation the post was shared, the created post ID, and the final post text used.',
    },
    {
      name: 'repurpose-content-to-post',
      description:
        'Turn a blog post, release note, or announcement into a punchy LinkedIn post and share it.',
      content:
        '# Repurpose Content to Post\n\nRepurpose long-form content into a native LinkedIn post.\n\n## Steps\n1. Read the source content and pull out the single most compelling insight or takeaway.\n2. Rewrite it as a standalone LinkedIn post with a hook, a concise body, and a call-to-action or link.\n3. Share Post with PUBLIC visibility.\n\n## Output\nThe published post ID and the post text, plus a note of the source it was derived from.',
    },
    {
      name: 'get-my-profile',
      description:
        'Fetch your LinkedIn profile information for use in downstream personalization or logging.',
      content:
        '# Get My Profile\n\nRetrieve your authenticated LinkedIn profile.\n\n## Steps\n1. Run Get Profile to fetch the connected account profile.\n2. Extract the fields you need, such as name and identifiers, for personalization or record-keeping.\n\n## Output\nThe profile JSON and a short summary of the key fields available.',
    },
  ],
} as const satisfies BlockMeta
