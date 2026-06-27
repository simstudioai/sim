import { BrowserUseIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const BrowserUseBlockDisplay = {
  type: 'browser_use',
  name: 'Browser Use',
  description: 'Run browser automation tasks',
  category: 'tools',
  bgColor: '#181C1E',
  icon: BrowserUseIcon,
  longDescription:
    'Integrate Browser Use into the workflow. Can navigate the web and perform actions as if a real user was interacting with the browser.',
  docsLink: 'https://docs.sim.ai/integrations/browser_use',
  integrationType: IntegrationType.AI,
} satisfies BlockDisplay
