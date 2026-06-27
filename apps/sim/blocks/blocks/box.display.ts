import { BoxCompanyIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const BoxBlockDisplay = {
  type: 'box',
  name: 'Box',
  description: 'Manage files, folders, and e-signatures with Box',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: BoxCompanyIcon,
  longDescription:
    'Integrate Box into your workflow to manage files, folders, and e-signatures. Upload and download files, search content, create folders, send documents for e-signature, track signing status, and more.',
  docsLink: 'https://docs.sim.ai/integrations/box',
  integrationType: IntegrationType.Documents,
} satisfies BlockDisplay
