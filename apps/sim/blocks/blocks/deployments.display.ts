import { SimDeploymentsIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'

export const DeploymentsBlockDisplay = {
  type: 'deployments',
  name: 'Deployments',
  description: 'Manage workflow deployments',
  category: 'blocks',
  bgColor: '#0C0C0C',
  icon: SimDeploymentsIcon,
  iconColor: '#33C482',
  longDescription:
    'Deploy, undeploy, and roll back workflows in the current workspace. Promote a previous deployment version to live, list every version, or fetch the deployed workflow state for a specific version.',
  docsLink: 'https://docs.sim.ai/workflows/deployment',
} satisfies BlockDisplay
