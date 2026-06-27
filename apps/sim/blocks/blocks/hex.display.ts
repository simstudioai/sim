import { HexIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const HexBlockDisplay = {
  type: 'hex',
  name: 'Hex',
  description: 'Run and manage Hex projects',
  category: 'tools',
  bgColor: '#14151A',
  icon: HexIcon,
  longDescription:
    'Integrate Hex into your workflow. Run projects, check run status, manage collections and groups, list users, and view data connections. Requires a Hex API token.',
  docsLink: 'https://docs.sim.ai/integrations/hex',
  integrationType: IntegrationType.Analytics,
} satisfies BlockDisplay
