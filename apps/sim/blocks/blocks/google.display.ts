import { GoogleIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const GoogleSearchBlockDisplay = {
  type: 'google_search',
  name: 'Google Search',
  description: 'Search the web',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: GoogleIcon,
  longDescription: 'Integrate Google Search into the workflow. Can search the web.',
  docsLink: 'https://docs.sim.ai/integrations/google_search',
  integrationType: IntegrationType.Search,
} satisfies BlockDisplay
