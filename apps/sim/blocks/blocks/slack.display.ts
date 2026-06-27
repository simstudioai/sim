import { SlackIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const SlackBlockDisplay = {
  type: 'slack',
  name: 'Slack',
  description:
    'Send, update, delete messages, manage views and modals, add or remove reactions, manage canvases, get channel info and user presence in Slack',
  category: 'tools',
  bgColor: '#611f69',
  icon: SlackIcon,
  longDescription:
    'Integrate Slack into the workflow. Can send, update, and delete messages, send ephemeral messages visible only to a specific user, open/update/push modal views, publish Home tab views, create canvases, read messages, and add or remove reactions. Requires Bot Token instead of OAuth in advanced mode. Can be used in trigger mode to trigger a workflow when a message is sent to a channel.',
  docsLink: 'https://docs.sim.ai/integrations/slack',
  integrationType: IntegrationType.Communication,
  triggerAllowed: true,
} satisfies BlockDisplay
