import { DagsterIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const DagsterBlockDisplay = {
  type: 'dagster',
  name: 'Dagster',
  description: 'Orchestrate data pipelines and manage job runs with Dagster',
  category: 'tools',
  bgColor: '#ffffff',
  icon: DagsterIcon,
  longDescription:
    'Connect to a Dagster instance to launch job runs, monitor run status, list available jobs across repositories, terminate or delete runs, reexecute failed runs, fetch run logs, and manage schedules and sensors. API token only required for Dagster+.',
  docsLink: 'https://docs.sim.ai/integrations/dagster',
  integrationType: IntegrationType.Observability,
} satisfies BlockDisplay
