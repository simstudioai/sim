import { WordpressIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const WordPressBlockDisplay = {
  type: 'wordpress',
  name: 'WordPress',
  description: 'Manage WordPress content',
  category: 'tools',
  bgColor: '#21759B',
  icon: WordpressIcon,
  iconColor: '#21759B',
  longDescription:
    'Integrate with WordPress to create, update, and manage posts, pages, media, comments, categories, tags, and users. Supports WordPress.com sites via OAuth and self-hosted WordPress sites using Application Passwords authentication.',
  docsLink: 'https://docs.sim.ai/integrations/wordpress',
  integrationType: IntegrationType.Marketing,
} satisfies BlockDisplay
