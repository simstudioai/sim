import { RedisIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const RedisBlockDisplay = {
  type: 'redis',
  name: 'Redis',
  description: 'Key-value operations with Redis',
  category: 'tools',
  bgColor: '#FF4438',
  icon: RedisIcon,
  iconColor: '#FF4438',
  longDescription:
    'Connect to any Redis instance to perform key-value, hash, list, and utility operations via a direct connection.',
  docsLink: 'https://docs.sim.ai/integrations/redis',
  integrationType: IntegrationType.Databases,
} satisfies BlockDisplay
