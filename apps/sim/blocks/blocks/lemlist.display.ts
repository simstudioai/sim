import { LemlistIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const LemlistBlockDisplay = {
  type: 'lemlist',
  name: 'Lemlist',
  description: 'Manage outreach activities, leads, and send emails via Lemlist',
  category: 'tools',
  bgColor: '#316BFF',
  icon: LemlistIcon,
  longDescription:
    'Integrate Lemlist into your workflow. Retrieve campaign activities and replies, get lead information, and send emails through the Lemlist inbox.',
  docsLink: 'https://docs.sim.ai/integrations/lemlist',
  integrationType: IntegrationType.Email,
} satisfies BlockDisplay
