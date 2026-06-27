import { DiscordIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const DiscordBlockDisplay = {
  type: 'discord',
  name: 'Discord',
  description: 'Interact with Discord',
  category: 'tools',
  bgColor: '#5865F2',
  icon: DiscordIcon,
  iconColor: '#5865F2',
  longDescription:
    'Comprehensive Discord integration: messages, threads, channels, roles, members, invites, and webhooks.',
  docsLink: 'https://docs.sim.ai/integrations/discord',
  integrationType: IntegrationType.Communication,
} satisfies BlockDisplay
