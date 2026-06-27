import { SapS4HanaIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

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

export const SapS4HanaBlockMeta = {
  tags: ['automation'],
  url: 'https://www.sap.com/products/erp/s4hana.html',
  templates: [
    {
      icon: SapS4HanaIcon,
      title: 'SAP business partner sync',
      prompt:
        'Build a workflow that takes new customer rows from a CRM-backed table and creates or updates SAP S/4HANA business partners via the API_BUSINESS_PARTNER service, mapping person and organization categories correctly so finance and sales stay aligned.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'enterprise', 'sync'],
    },
    {
      icon: SapS4HanaIcon,
      title: 'SAP sales order monitor',
      prompt:
        'Create a scheduled workflow that lists open SAP S/4HANA sales orders, flags orders past their expected delivery date, summarizes top blockers, logs them to a tracking table, and emails the operations leads a daily prioritized list.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'enterprise', 'monitoring'],
    },
    {
      icon: SapS4HanaIcon,
      title: 'SAP supplier invoice intake',
      prompt:
        'Build a workflow that ingests inbound supplier invoice PDFs from Gmail, extracts header and line-item data with an agent, validates the vendor against SAP S/4HANA suppliers, creates the supplier invoice via OData, and writes the outcome to a finance audit table.',
      modules: ['files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'enterprise', 'automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: SapS4HanaIcon,
      title: 'SAP billing reconciliation',
      prompt:
        'Create a scheduled workflow that pulls SAP S/4HANA billing documents, joins them against your CRM revenue table, flags mismatches in amounts or customers, and emails finance a reconciliation report file with the specific rows to investigate.',
      modules: ['scheduled', 'tables', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['finance', 'enterprise', 'reporting'],
    },
    {
      icon: SapS4HanaIcon,
      title: 'SAP delivery exception alerts',
      prompt:
        'Build a workflow that runs every hour, lists SAP S/4HANA outbound and inbound deliveries with delays or missing reference documents, classifies the exception, posts a Slack alert to the operations channel, and updates a remediation tracking table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'enterprise', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SapS4HanaIcon,
      title: 'SAP stock-level digest',
      prompt:
        'Create a scheduled daily workflow that queries SAP S/4HANA for product stock and material document movements, identifies SKUs trending toward stock-out, writes a prioritized digest file, and Slacks the supply chain team for action.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['operations', 'enterprise', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SapS4HanaIcon,
      title: 'Purchase requisition router',
      prompt:
        'Build a workflow exposed to internal users as a form that captures purchase requisition details, classifies the request, creates the requisition in SAP S/4HANA via OData, posts the requisition number back to the requester, and logs the request in a tracking table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'enterprise', 'automation'],
    },
  ],
  skills: [
    {
      name: 'look-up-business-partner',
      description:
        'Find a customer, supplier, or business partner in SAP S4HANA and return their master data.',
      content:
        '# Look Up Business Partner\n\nRetrieve master data for a customer, supplier, or general business partner.\n\n## Steps\n1. Run List Business Partners (or List Customers / List Suppliers for the typed view) with a filter on name, ID, or other criteria.\n2. Once the right record is identified, run Get Business Partner, Get Customer, or Get Supplier to pull full detail.\n3. Note key fields such as the partner ID, addresses, roles, and payment terms.\n\n## Output\nReturn the matched partner ID and the relevant master-data fields, and call out if no match or multiple matches were found.',
    },
    {
      name: 'check-sales-order-status',
      description:
        'Look up a SAP S4HANA sales order and trace its related deliveries and billing documents.',
      content:
        '# Check Sales Order Status\n\nTrace a sales order from creation through delivery and billing.\n\n## Steps\n1. Run List Sales Orders to find the order, or Get Sales Order if you already have the order number.\n2. Run List Outbound Deliveries and List Billing Documents to find the delivery and invoice tied to that order.\n3. Get any specific delivery or billing document for line-level detail.\n\n## Output\nReturn the sales order number, its status, the linked delivery numbers, and billing document numbers so the order-to-cash state is clear.',
    },
    {
      name: 'create-purchase-requisition',
      description:
        'Create a purchase requisition in SAP S4HANA via OData from supplied line-item details.',
      content:
        '# Create Purchase Requisition\n\nRaise a purchase requisition for procurement.\n\n## Steps\n1. Gather the requisition header and line items: material or product, quantity, plant, and delivery date.\n2. Optionally run List Products and Get Product to confirm material numbers before submitting.\n3. Run Create Purchase Requisition with the assembled payload.\n4. Confirm by running Get Purchase Requisition on the returned number.\n\n## Output\nReport the created purchase requisition number and a summary of its line items, and surface any OData validation error verbatim.',
    },
    {
      name: 'check-material-stock',
      description:
        'Read current material stock and recent material documents for an item in SAP S4HANA.',
      content:
        '# Check Material Stock\n\nReport on-hand stock and recent inventory movements for a material.\n\n## Steps\n1. Run List Material Stock filtered by the material and plant to read current quantities.\n2. Run List Material Documents to see recent goods movements for that material, and Get Material Document for line detail on a specific posting.\n3. Compare on-hand stock against expected levels.\n\n## Output\nReturn the material number, plant, current stock quantity, and a short list of recent material movements with their document numbers.',
    },
  ],
} as const satisfies BlockMeta
