import { LaunchDarklyIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const LaunchDarklyBlockDisplay = {
  type: 'launchdarkly',
  name: 'LaunchDarkly',
  description: 'Manage feature flags with LaunchDarkly.',
  category: 'tools',
  bgColor: '#191919',
  icon: LaunchDarklyIcon,
  iconColor: '#405BFF',
  longDescription:
    'Integrate LaunchDarkly into your workflow. List, create, update, toggle, and delete feature flags. Manage projects, environments, segments, members, and audit logs. Requires API Key.',
  docsLink: 'https://docs.sim.ai/integrations/launchdarkly',
  integrationType: IntegrationType.DevOps,
} satisfies BlockDisplay
