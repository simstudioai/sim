import { GoogleFormsIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const GoogleFormsBlockDisplay = {
  type: 'google_forms',
  name: 'Google Forms',
  description: 'Manage Google Forms and responses',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: GoogleFormsIcon,
  longDescription:
    'Integrate Google Forms into your workflow. Read form structure, get responses, create forms, update content, and manage notification watches.',
  docsLink: 'https://docs.sim.ai/integrations/google_forms',
  integrationType: IntegrationType.Documents,
} satisfies BlockDisplay
