import { ResendIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const ResendBlockDisplay = {
  type: 'resend',
  name: 'Resend',
  description: 'Send emails and manage contacts with Resend.',
  category: 'tools',
  bgColor: '#181C1E',
  icon: ResendIcon,
  longDescription:
    'Integrate Resend into your workflow. Send emails, retrieve email status, manage contacts, and view domains. Requires API Key.',
  docsLink: 'https://docs.sim.ai/integrations/resend',
  integrationType: IntegrationType.Email,
} satisfies BlockDisplay
