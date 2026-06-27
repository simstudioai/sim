import { SapConcurIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const SapConcurBlockDisplay = {
  type: 'sap_concur',
  name: 'SAP Concur',
  description: 'Manage expense reports, travel requests, cash advances, and more in SAP Concur',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: SapConcurIcon,
  longDescription:
    'Connect SAP Concur via OAuth 2.0. Manage expense reports and line items, allocations, attendees, comments, exceptions, quick expenses, receipts, travel requests and expected expenses, cash advances, itineraries, user identities, custom lists, budgets, exchange rates, and purchase requests across every Concur datacenter.',
  docsLink: 'https://docs.sim.ai/integrations/sap_concur',
  integrationType: IntegrationType.Productivity,
} satisfies BlockDisplay
