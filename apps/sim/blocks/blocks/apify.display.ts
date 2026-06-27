import { ApifyIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const ApifyBlockDisplay = {
  type: 'apify',
  name: 'Apify',
  description: 'Run Apify actors and retrieve results',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: ApifyIcon,
  longDescription:
    'Integrate Apify into your workflow. Run any Apify actor or saved task with custom input, fetch dataset items, and check run status. Supports both synchronous and asynchronous execution with automatic dataset fetching.',
  docsLink: 'https://docs.sim.ai/integrations/apify',
  integrationType: IntegrationType.Search,
} satisfies BlockDisplay
