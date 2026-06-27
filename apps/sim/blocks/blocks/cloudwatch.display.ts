import { CloudWatchIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const CloudWatchBlockDisplay = {
  type: 'cloudwatch',
  name: 'CloudWatch',
  description: 'Query and monitor AWS CloudWatch logs, metrics, and alarms',
  category: 'tools',
  bgColor: 'linear-gradient(45deg, #B0084D 0%, #FF4F8B 100%)',
  icon: CloudWatchIcon,
  iconColor: '#FF4F8B',
  longDescription:
    'Integrate AWS CloudWatch into workflows. Run Log Insights queries, list log groups, retrieve log events, list and get metrics, and monitor alarms. Requires AWS access key and secret access key.',
  docsLink: 'https://docs.sim.ai/integrations/cloudwatch',
  integrationType: IntegrationType.Observability,
} satisfies BlockDisplay
