import { Neo4jIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const Neo4jBlockDisplay = {
  type: 'neo4j',
  name: 'Neo4j',
  description: 'Connect to Neo4j graph database',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: Neo4jIcon,
  longDescription:
    'Integrate Neo4j graph database into the workflow. Can query, create, merge, update, and delete nodes and relationships.',
  docsLink: 'https://docs.sim.ai/integrations/neo4j',
  integrationType: IntegrationType.Databases,
} satisfies BlockDisplay
