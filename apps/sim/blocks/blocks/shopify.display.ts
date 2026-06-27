import { ShopifyIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

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
