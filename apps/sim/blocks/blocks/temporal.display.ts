import { TemporalIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const TemporalBlockDisplay = {
  type: 'temporal',
  name: 'Temporal',
  description: 'Start, signal, query, and manage Temporal workflow executions',
  category: 'tools',
  bgColor: '#141414',
  icon: TemporalIcon,
  longDescription:
    "Connect to a Temporal cluster over the server's HTTP API to start workflow executions, send signals, run queries against workflow state, describe and list executions, fetch event histories, and cancel or terminate running workflows. API key only required for servers with authentication enabled.",
  docsLink: 'https://docs.sim.ai/integrations/temporal',
  integrationType: IntegrationType.DevOps,
} satisfies BlockDisplay
