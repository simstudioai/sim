import { STSIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const STSBlockDisplay = {
  type: 'sts',
  name: 'AWS STS',
  description: 'Connect to AWS Security Token Service',
  category: 'tools',
  bgColor: 'linear-gradient(45deg, #BD0816 0%, #FF5252 100%)',
  icon: STSIcon,
  longDescription:
    'Integrate AWS STS into the workflow. Assume roles, get temporary credentials, verify caller identity, and look up access key information.',
  docsLink: 'https://docs.sim.ai/integrations/sts',
  integrationType: IntegrationType.Security,
} satisfies BlockDisplay
