import { GitLabIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const GitLabBlockDisplay = {
  type: 'gitlab',
  name: 'GitLab',
  description: 'Interact with GitLab projects, issues, merge requests, and pipelines',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: GitLabIcon,
  longDescription:
    'Integrate GitLab into the workflow. Can manage projects, issues, merge requests, pipelines, and add comments. Supports all core GitLab DevOps operations.',
  docsLink: 'https://docs.sim.ai/integrations/gitlab',
  integrationType: IntegrationType.DevOps,
  triggerAllowed: true,
} satisfies BlockDisplay
