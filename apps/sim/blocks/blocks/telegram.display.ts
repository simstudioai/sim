import { TelegramIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const TelegramBlockDisplay = {
  type: 'telegram',
  name: 'Telegram',
  description: 'Interact with Telegram',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: TelegramIcon,
  longDescription:
    'Integrate Telegram into the workflow. Can send and delete messages. Can be used in trigger mode to trigger a workflow when a message is sent to a chat.',
  docsLink: 'https://docs.sim.ai/integrations/telegram',
  integrationType: IntegrationType.Communication,
  triggerAllowed: true,
} satisfies BlockDisplay
