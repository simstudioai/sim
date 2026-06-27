import { RailwayIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const RailwayBlockDisplay = {
  type: 'railway',
  name: 'Railway',
  description: 'Manage Railway projects, services, deployments, and variables',
  category: 'tools',
  bgColor: '#000000',
  icon: RailwayIcon,
  longDescription:
    'Integrate Railway into workflows to list projects, manage services and environments, monitor deployments, trigger and roll back service deployments, and manage environment variables.',
  docsLink: 'https://docs.sim.ai/integrations/railway',
  integrationType: IntegrationType.DevOps,
} satisfies BlockDisplay
