import { LinqIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const LinqBlockDisplay = {
  type: 'linq',
  name: 'Linq',
  description: 'Send iMessage, SMS, and RCS messages and manage conversations with Linq',
  category: 'tools',
  bgColor: '#000000',
  icon: LinqIcon,
  longDescription:
    'Reach people on iMessage, SMS, and RCS through Linq. Start chats, send messages with media, links, effects, and replies, send voice memos, react with tapbacks, manage group participants, check iMessage/RCS capability, configure contact cards, and subscribe to webhook events — all through a single Linq API key.',
  docsLink: 'https://docs.sim.ai/integrations/linq',
  integrationType: IntegrationType.Communication,
} satisfies BlockDisplay
