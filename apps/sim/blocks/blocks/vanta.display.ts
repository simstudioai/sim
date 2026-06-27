import { VantaIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const VantaBlockDisplay = {
  type: 'vanta',
  name: 'Vanta',
  description: 'Query compliance status and manage evidence in Vanta',
  category: 'tools',
  bgColor: '#F8F4F3',
  icon: VantaIcon,
  longDescription:
    'Integrate Vanta into the workflow. Monitor compliance frameworks, controls, and automated tests; find failing test entities; manage evidence documents including file upload, download, and submission; and track people, policies, vendors, monitored computers, vulnerabilities, and risk scenarios. Requires Vanta OAuth client credentials.',
  docsLink: 'https://docs.sim.ai/integrations/vanta',
  integrationType: IntegrationType.Security,
} satisfies BlockDisplay
