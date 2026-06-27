import { Neo4jIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

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

export const Neo4jBlockMeta = {
  tags: ['data-warehouse', 'data-analytics'],
  url: 'https://neo4j.com',
  templates: [
    {
      icon: Neo4jIcon,
      title: 'Neo4j relationship exporter',
      prompt:
        'Build a workflow that queries Neo4j for a chosen entity graph, writes the nodes and edges to a structured JSON adjacency file, and shares the file link for a downstream tool to visualize.',
      modules: ['agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['analysis', 'research'],
    },
    {
      icon: Neo4jIcon,
      title: 'Neo4j fraud-ring detector',
      prompt:
        'Create a scheduled workflow that queries Neo4j for suspicious connection patterns — shared devices, overlapping addresses — writes risk-scored clusters to a fraud table, and pings Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'analysis'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: Neo4jIcon,
      title: 'Neo4j org-chart sync',
      prompt:
        'Build a workflow that pulls Workday or Rippling worker data, upserts employees and reporting relationships into Neo4j, and exposes a queryable org graph for downstream tools.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'sync'],
      alsoIntegrations: ['workday', 'rippling'],
    },
    {
      icon: Neo4jIcon,
      title: 'Neo4j knowledge-graph builder',
      prompt:
        'Create a workflow that processes documents from a knowledge base, extracts entities and relationships with an agent, and writes the graph into Neo4j for cross-document insights.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['research', 'enterprise'],
    },
    {
      icon: Neo4jIcon,
      title: 'Neo4j recommendation engine',
      prompt:
        'Build a workflow that runs Neo4j graph algorithms — collaborative filtering, PageRank — on product-purchase data and writes per-user recommendations to a personalization table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'analysis'],
    },
    {
      icon: Neo4jIcon,
      title: 'Neo4j data lineage tracker',
      prompt:
        'Create a workflow that ingests dbt manifest metadata into Neo4j, tracks lineage across tables and pipelines, and queries impact when a source schema changes.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'analysis'],
    },
    {
      icon: Neo4jIcon,
      title: 'Neo4j natural-language graph explorer',
      prompt:
        'Build a chat agent that introspects the Neo4j schema, translates plain-English questions like “which customers share a support agent with churned accounts?” into Cypher queries, runs them, and returns a readable answer with the matching nodes.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['analysis', 'research', 'automation'],
    },
  ],
  skills: [
    {
      name: 'answer-graph-question',
      description:
        'Translate a plain-English question into Cypher, run it on Neo4j, and explain the result.',
      content:
        '# Answer Graph Question\n\nTurn a natural-language question into a Cypher query against the Neo4j graph.\n\n## Steps\n1. Run Introspect Schema to learn the node labels, relationship types, and properties.\n2. Translate the question into a Cypher MATCH that uses the real labels and relationships from the schema.\n3. Run the Query operation and read the returned rows.\n4. If the query returns nothing, relax the pattern and explain what was tried.\n\n## Output\nA plain-language answer plus the Cypher used and the key matching nodes or paths.',
    },
    {
      name: 'create-graph-relationship',
      description: 'Create or merge nodes and connect them with a relationship in Neo4j.',
      content:
        '# Create Graph Relationship\n\nAdd nodes and a relationship between them without creating duplicates.\n\n## Steps\n1. Introspect Schema to confirm the labels and relationship type to use.\n2. Use Merge (Find or Create) for each node so existing nodes are reused rather than duplicated.\n3. Create the relationship between them with the requested direction and any properties.\n\n## Output\nConfirm the nodes involved and the relationship created, noting whether each node was found or newly created.',
    },
    {
      name: 'find-connected-nodes',
      description: 'Traverse the Neo4j graph from a starting node to find related entities.',
      content:
        '# Find Connected Nodes\n\nExplore the neighborhood of a node to find connected entities.\n\n## Steps\n1. Introspect Schema to know the relationship types available.\n2. Build a Cypher MATCH that starts at the given node and traverses the relevant relationships to the desired depth.\n3. Run the Query operation and collect the connected nodes.\n\n## Output\nA list of connected nodes grouped by relationship type, with the traversal path described in one line.',
    },
  ],
} as const satisfies BlockMeta
