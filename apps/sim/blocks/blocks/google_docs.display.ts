import { GoogleDocsIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const GoogleDocsBlockDisplay = {
  type: 'google_docs',
  name: 'Google Docs',
  description: 'Read, write, and create documents',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: GoogleDocsIcon,
  longDescription:
    'Integrate Google Docs into the workflow. Can read, write, and create documents.',
  docsLink: 'https://docs.sim.ai/integrations/google_docs',
  integrationType: IntegrationType.Documents,
} satisfies BlockDisplay
