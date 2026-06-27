import { IntercomIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const IntercomBlockDisplay = {
  type: 'intercom',
  name: 'Intercom (Legacy)',
  description: 'Manage contacts, companies, conversations, tickets, and messages in Intercom',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: IntercomIcon,
  longDescription:
    'Integrate Intercom into the workflow. Can create, get, update, list, search, and delete contacts; create, get, and list companies; get, list, reply, and search conversations; create and get tickets; and create messages.',
  docsLink: 'https://docs.sim.ai/integrations/intercom',
  integrationType: IntegrationType.Support,
  hideFromToolbar: true,
} satisfies BlockDisplay

export const IntercomV2BlockDisplay = {
  ...IntercomBlockDisplay,
  type: 'intercom_v2',
  name: 'Intercom',
  integrationType: IntegrationType.Support,
  hideFromToolbar: false,
} satisfies BlockDisplay
