import { SQSIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const SQSBlockDisplay = {
  type: 'sqs',
  name: 'Amazon SQS',
  description: 'Connect to Amazon SQS',
  category: 'tools',
  bgColor: 'linear-gradient(45deg, #2E27AD 0%, #527FFF 100%)',
  icon: SQSIcon,
  iconColor: '#527FFF',
  longDescription: 'Integrate Amazon SQS into the workflow. Can send messages to SQS queues.',
  docsLink: 'https://docs.sim.ai/integrations/sqs',
  integrationType: IntegrationType.DevOps,
} satisfies BlockDisplay
