import { ZendeskIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const ZendeskBlockDisplay = {
  type: 'zendesk',
  name: 'Zendesk',
  description: 'Manage support tickets, users, and organizations in Zendesk',
  category: 'tools',
  bgColor: '#03363D',
  icon: ZendeskIcon,
  longDescription:
    'Integrate Zendesk into the workflow. Can get tickets, get ticket, create ticket, create tickets bulk, update ticket, update tickets bulk, delete ticket, merge tickets, get users, get user, get current user, search users, create user, create users bulk, update user, update users bulk, delete user, get organizations, get organization, autocomplete organizations, create organization, create organizations bulk, update organization, delete organization, search, search count.',
  docsLink: 'https://docs.sim.ai/integrations/zendesk',
  integrationType: IntegrationType.Support,
  triggerAllowed: true,
} satisfies BlockDisplay
