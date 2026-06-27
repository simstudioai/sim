import { MicrosoftTeamsIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const MicrosoftTeamsBlockDisplay = {
  type: 'microsoft_teams',
  name: 'Microsoft Teams',
  description: 'Manage messages, reactions, and members in Teams',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: MicrosoftTeamsIcon,
  longDescription:
    'Integrate Microsoft Teams into the workflow. Read, write, update, and delete chat and channel messages. Reply to messages, add reactions, and list team/channel members. Can be used in trigger mode to trigger a workflow when a message is sent to a chat or channel. To mention users in messages, wrap their name in `<at>` tags: `<at>userName</at>`',
  docsLink: 'https://docs.sim.ai/integrations/microsoft_teams',
  integrationType: IntegrationType.Communication,
  triggerAllowed: true,
} satisfies BlockDisplay
