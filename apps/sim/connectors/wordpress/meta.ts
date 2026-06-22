import { WordpressIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const DEFAULT_MAX_POSTS = 100

export const wordpressConnectorMeta: ConnectorMeta = {
  id: 'wordpress',
  name: 'WordPress',
  description:
    'Sync posts and pages from a WordPress.com site. OAuth tokens expire after ~2 weeks (no refresh token).',
  version: '1.0.0',
  icon: WordpressIcon,

  auth: { mode: 'oauth', provider: 'wordpress', requiredScopes: ['global'] },

  configFields: [
    {
      id: 'siteUrl',
      title: 'Site URL',
      type: 'short-input',
      placeholder: 'e.g. mysite.wordpress.com',
      required: true,
      description: 'WordPress site domain',
    },
    {
      id: 'postType',
      title: 'Post Type',
      type: 'dropdown',
      required: false,
      description: 'Filter by content type',
      options: [
        { label: 'Both', id: 'Both' },
        { label: 'Posts', id: 'Posts' },
        { label: 'Pages', id: 'Pages' },
      ],
    },
    {
      id: 'maxPosts',
      title: 'Max Posts',
      type: 'short-input',
      required: false,
      placeholder: `e.g. 50 (default: ${DEFAULT_MAX_POSTS})`,
      description: 'Maximum number of posts to sync',
    },
  ],

  tagDefinitions: [
    { id: 'author', displayName: 'Author', fieldType: 'text' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
    { id: 'postType', displayName: 'Post Type', fieldType: 'text' },
    { id: 'categories', displayName: 'Categories', fieldType: 'text' },
    { id: 'tags', displayName: 'Tags', fieldType: 'text' },
  ],
}
