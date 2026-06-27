import { WebflowIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const WebflowBlockDisplay = {
  type: 'webflow',
  name: 'Webflow',
  description: 'Manage Webflow CMS collections',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: WebflowIcon,
  longDescription:
    'Integrates Webflow CMS into the workflow. Can create, get, list, update, or delete items in Webflow CMS collections. Manage your Webflow content programmatically. Can be used in trigger mode to trigger workflows when collection items change or forms are submitted.',
  docsLink: 'https://docs.sim.ai/integrations/webflow',
  integrationType: IntegrationType.Marketing,
  triggerAllowed: true,
} satisfies BlockDisplay
