import { GithubIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const GitHubBlockDisplay = {
  type: 'github',
  name: 'GitHub (Legacy)',
  description: 'Interact with GitHub or trigger workflows from GitHub events',
  category: 'tools',
  bgColor: '#181C1E',
  icon: GithubIcon,
  longDescription:
    'Integrate Github into the workflow. Can get get PR details, create PR comment, get repository info, and get latest commit. Can be used in trigger mode to trigger a workflow when a PR is created, commented on, or a commit is pushed.',
  docsLink: 'https://docs.sim.ai/integrations/github',
  integrationType: IntegrationType.DevOps,
  hideFromToolbar: true,
  triggerAllowed: true,
} satisfies BlockDisplay

export const GitHubV2BlockDisplay = {
  ...GitHubBlockDisplay,
  type: 'github_v2',
  name: 'GitHub',
  integrationType: IntegrationType.DevOps,
  hideFromToolbar: false,
} satisfies BlockDisplay
