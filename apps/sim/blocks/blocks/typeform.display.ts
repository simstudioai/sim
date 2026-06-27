import { TypeformIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const TypeformBlockDisplay = {
  type: 'typeform',
  name: 'Typeform',
  description: 'Interact with Typeform',
  category: 'tools',
  bgColor: '#262627',
  icon: TypeformIcon,
  longDescription:
    'Integrate Typeform into the workflow. Can retrieve responses, download files, and get form insights. Can be used in trigger mode to trigger a workflow when a form is submitted. Requires API Key.',
  docsLink: 'https://docs.sim.ai/integrations/typeform',
  integrationType: IntegrationType.Documents,
} satisfies BlockDisplay
