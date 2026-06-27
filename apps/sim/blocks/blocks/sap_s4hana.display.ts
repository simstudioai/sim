import { SapS4HanaIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const SapS4HanaBlockDisplay = {
  type: 'sap_s4hana',
  name: 'SAP S4HANA',
  description: 'Read and write SAP S4HANA Cloud business data via OData',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: SapS4HanaIcon,
  longDescription:
    'Connect SAP S4HANA Cloud Public Edition with per-tenant OAuth 2.0 client credentials configured in your Communication Arrangements. Read and create business partners, customers, suppliers, sales orders, deliveries (inbound/outbound), billing documents, products, stock and material documents, purchase requisitions, purchase orders, and supplier invoices, or run arbitrary OData v2 queries against any whitelisted Communication Scenario.',
  docsLink: 'https://docs.sim.ai/integrations/sap_s4hana',
  integrationType: IntegrationType.HR,
} satisfies BlockDisplay
