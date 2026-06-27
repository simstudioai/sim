import { PosthogIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const PostHogBlockDisplay = {
  type: 'posthog',
  name: 'PostHog',
  description: 'Product analytics and feature management',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: PosthogIcon,
  longDescription:
    'Integrate PostHog into your workflow. Track events, manage feature flags, analyze user behavior, run experiments, create surveys, and access session recordings.',
  docsLink: 'https://docs.sim.ai/integrations/posthog',
  integrationType: IntegrationType.Analytics,
} satisfies BlockDisplay
