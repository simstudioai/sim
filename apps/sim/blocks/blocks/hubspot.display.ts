import { HubspotIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const HubSpotBlockDisplay = {
  type: 'hubspot',
  name: 'HubSpot',
  description: 'Interact with HubSpot CRM or trigger workflows from HubSpot events',
  category: 'tools',
  bgColor: '#FF7A59',
  icon: HubspotIcon,
  iconColor: '#FF7A59',
  longDescription:
    'Integrate HubSpot into your workflow. Manage contacts, companies, deals, tickets, and other CRM objects with powerful automation capabilities. Can be used in trigger mode to start workflows when records are created, updated, a specific property changes, or a contact joins a list.',
  docsLink: 'https://docs.sim.ai/integrations/hubspot',
  integrationType: IntegrationType.Sales,
  triggerAllowed: true,
} satisfies BlockDisplay
