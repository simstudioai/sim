import { DocuSignIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const DocuSignBlockDisplay = {
  type: 'docusign',
  name: 'DocuSign',
  description: 'Send documents for e-signature via DocuSign',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: DocuSignIcon,
  longDescription:
    'Create and send envelopes for e-signature, use templates, check signing status, download signed documents, and manage recipients with DocuSign.',
  docsLink: 'https://docs.sim.ai/integrations/docusign',
  integrationType: IntegrationType.Documents,
} satisfies BlockDisplay
