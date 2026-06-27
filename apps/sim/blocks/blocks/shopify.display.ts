import { ShopifyIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const ShopifyBlockDisplay = {
  type: 'shopify',
  name: 'Shopify',
  description: 'Manage products, orders, customers, and inventory in your Shopify store',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: ShopifyIcon,
  longDescription:
    'Integrate Shopify into your workflow. Manage products, orders, customers, and inventory. Create, read, update, and delete products. List and manage orders. Handle customer data and adjust inventory levels.',
  docsLink: 'https://docs.sim.ai/integrations/shopify',
  integrationType: IntegrationType.Commerce,
} satisfies BlockDisplay

export const ShopifyBlockMeta = {
  tags: ['payments', 'automation'],
  url: 'https://www.shopify.com',
  templates: [
    {
      icon: ShopifyIcon,
      title: 'E-commerce order monitor',
      prompt:
        'Build a workflow that monitors Shopify orders, flags high-value or unusual orders for review, tracks fulfillment status in a table, and sends daily inventory and sales summaries to Slack with restock alerts when items run low.',
      modules: ['tables', 'scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['ecommerce', 'monitoring', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ShopifyIcon,
      title: 'Unpaid order recovery',
      prompt:
        'Build a scheduled workflow that lists Shopify orders left open and unpaid in the past day, drafts a personalized recovery email referencing the items, and sends it via Gmail while logging recovery attempts to a table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['ecommerce', 'marketing', 'automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: ShopifyIcon,
      title: 'Low-stock restock alerter',
      prompt:
        'Create a scheduled hourly workflow that lists Shopify inventory items, computes days-of-cover from recent sales velocity, flags SKUs below a configurable threshold, and posts a Slack alert to the operations channel with the variant, location, and recommended reorder quantity.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['ecommerce', 'monitoring', 'operations'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ShopifyIcon,
      title: 'Shopify VIP segmenter',
      prompt:
        'Build a scheduled weekly workflow that pulls Shopify customers, calculates lifetime value and order frequency, segments them into VIP, regular, and at-risk cohorts in a tracking table, and emails the marketing team a list of new VIPs to nurture.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['ecommerce', 'marketing', 'analysis'],
    },
    {
      icon: ShopifyIcon,
      title: 'Fulfillment status tracker',
      prompt:
        'Create a scheduled workflow that lists Shopify orders and their fulfillment status, updates a status table with shipped, in-transit, and delivered states, and proactively emails customers when their order misses an SLA so support gets ahead of the inquiry.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['ecommerce', 'support', 'monitoring'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: ShopifyIcon,
      title: 'Product launch publisher',
      prompt:
        'Build a workflow that takes a new product brief, creates the product in Shopify with variants and pricing, adds it to the right collection, drafts a launch announcement, and queues a Slack and email broadcast for marketing review before going live.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['ecommerce', 'marketing', 'automation'],
      alsoIntegrations: ['gmail', 'slack'],
    },
    {
      icon: ShopifyIcon,
      title: 'Order anomaly detector',
      prompt:
        'Create a scheduled workflow that runs every fifteen minutes, lists recent Shopify orders, scores each for anomalies — high value, unusual destination, mismatched billing — flags suspects in a review queue table, and Slacks the operations team for hands-on inspection.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['ecommerce', 'monitoring', 'analysis'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'create-product-listing',
      description: 'Create a new Shopify product with title, description, status, and variants.',
      content:
        '# Create Product Listing\n\nAdd a new product to the Shopify store.\n\n## Steps\n1. Run Create Product with the title, body description, vendor, and product type.\n2. Set the status (active, draft, or archived) so the product publishes only when ready.\n3. Verify with Get Product on the returned product ID.\n\n## Output\nReturn the new product ID, title, and status, and confirm the listing was created as draft or active as intended.',
    },
    {
      name: 'process-recent-orders',
      description:
        'List recent Shopify orders and summarize them by status, value, or fulfillment need.',
      content:
        '# Process Recent Orders\n\nReview the latest orders to triage fulfillment and flag anything unusual.\n\n## Steps\n1. Run List Orders filtered by status (open, closed, cancelled, or any) and a recent time window.\n2. For orders needing detail, run Get Order to read line items, customer, and shipping address.\n3. Group orders by fulfillment status and total value.\n\n## Output\nReturn a summary of recent orders with their order numbers, totals, and status, highlighting any that need immediate fulfillment or review.',
    },
    {
      name: 'fulfill-order',
      description: 'Create a fulfillment for a Shopify order and update its status.',
      content:
        '# Fulfill Order\n\nMark an order as fulfilled once it has shipped.\n\n## Steps\n1. Run Get Order to confirm the order and its line items, and List Locations to identify the fulfilling location.\n2. Run Create Fulfillment for the order, supplying the location and tracking details if available.\n3. Optionally run Update Order to record any notes.\n\n## Output\nConfirm the order number, the fulfillment created, and any tracking number supplied.',
    },
    {
      name: 'adjust-inventory',
      description: 'Check and adjust Shopify inventory levels for an item at a location.',
      content:
        '# Adjust Inventory\n\nReconcile stock levels for an inventory item.\n\n## Steps\n1. Run List Inventory Items and List Locations to identify the item and the location.\n2. Run Get Inventory Level to read the current available quantity.\n3. Run Adjust Inventory with the delta needed to reach the correct count.\n\n## Output\nReport the inventory item, the location, the previous and new quantities, and the adjustment applied.',
    },
    {
      name: 'manage-customer-record',
      description: 'Create, look up, or update a Shopify customer record.',
      content:
        '# Manage Customer Record\n\nMaintain a customer profile in Shopify.\n\n## Steps\n1. To find an existing customer, run List Customers with a filter or Get Customer by ID.\n2. To add a new one, run Create Customer with name, email, and any tags.\n3. To change details, run Update Customer with only the fields to modify.\n\n## Output\nReturn the customer ID, name, and email, and note whether the record was created, found, or updated.',
    },
  ],
} as const satisfies BlockMeta
