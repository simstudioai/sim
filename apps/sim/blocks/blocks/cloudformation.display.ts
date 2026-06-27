import { CloudFormationIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const CloudFormationBlockDisplay = {
  type: 'cloudformation',
  name: 'CloudFormation',
  description: 'Manage and inspect AWS CloudFormation stacks, resources, and drift',
  category: 'tools',
  bgColor: 'linear-gradient(45deg, #B0084D 0%, #FF4F8B 100%)',
  icon: CloudFormationIcon,
  iconColor: '#FF4F8B',
  longDescription:
    'Integrate AWS CloudFormation into workflows. Describe stacks, list resources, detect drift, view stack events, retrieve templates, and validate templates. Requires AWS access key and secret access key.',
  docsLink: 'https://docs.sim.ai/integrations/cloudformation',
  integrationType: IntegrationType.DevOps,
} satisfies BlockDisplay
