import { UpstashIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const UpstashBlockDisplay = {
  type: 'upstash',
  name: 'Upstash',
  description: 'Serverless Redis with Upstash',
  category: 'tools',
  bgColor: '#181C1E',
  icon: UpstashIcon,
  longDescription:
    'Connect to Upstash Redis to perform key-value, hash, list, and utility operations via the REST API.',
  docsLink: 'https://docs.sim.ai/integrations/upstash',
  integrationType: IntegrationType.Databases,
} satisfies BlockDisplay
