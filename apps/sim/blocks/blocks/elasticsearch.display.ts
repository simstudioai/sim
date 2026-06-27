import { ElasticsearchIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const ElasticsearchBlockDisplay = {
  type: 'elasticsearch',
  name: 'Elasticsearch',
  description: 'Search, index, and manage data in Elasticsearch',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: ElasticsearchIcon,
  longDescription:
    'Integrate Elasticsearch into workflows for powerful search, indexing, and data management. Supports document CRUD operations, advanced search queries, bulk operations, index management, and cluster monitoring. Works with both self-hosted and Elastic Cloud deployments.',
  docsLink: 'https://docs.sim.ai/integrations/elasticsearch',
  integrationType: IntegrationType.Databases,
} satisfies BlockDisplay

export const ElasticsearchBlockMeta = {
  tags: ['vector-search', 'data-analytics'],
  url: 'https://www.elastic.co/elasticsearch',
  templates: [
    {
      icon: ElasticsearchIcon,
      title: 'Elasticsearch log triage',
      prompt:
        'Build a scheduled workflow that runs saved Elasticsearch queries hourly for error patterns, clusters the matches, writes the top groups to a triage table, and pings on-call.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['pagerduty'],
    },
    {
      icon: ElasticsearchIcon,
      title: 'Elasticsearch security event correlator',
      prompt:
        'Create a workflow that pulls Elasticsearch security events, correlates them across sources, and opens a CrowdStrike or PagerDuty incident on a confirmed pattern.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'monitoring'],
      alsoIntegrations: ['crowdstrike', 'pagerduty'],
    },
    {
      icon: ElasticsearchIcon,
      title: 'Elasticsearch index lifecycle audit',
      prompt:
        'Build a scheduled weekly workflow that audits Elasticsearch indices against retention policies, identifies over-retained data, and writes the cleanup plan to a Slack approval thread.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ElasticsearchIcon,
      title: 'Elasticsearch search-as-a-service connector',
      prompt:
        'Create a workflow that exposes a saved Elasticsearch query as an internal search endpoint, normalizes results into a standard shape, and writes usage telemetry to a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'automation'],
    },
    {
      icon: ElasticsearchIcon,
      title: 'Elasticsearch + knowledge base hybrid',
      prompt:
        'Build a workflow that combines Elasticsearch keyword search with a vector knowledge base, fuses results with reciprocal-rank fusion, and answers user questions with grounded citations.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'research'],
    },
    {
      icon: ElasticsearchIcon,
      title: 'Elasticsearch slow-query digest',
      prompt:
        'Create a scheduled daily workflow that aggregates Elasticsearch slow-log entries, clusters the top offenders, and posts a digest to the platform Slack channel with recommended fixes.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'devops'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ElasticsearchIcon,
      title: 'Elasticsearch + LangSmith retrieval evaluator',
      prompt:
        'Create a workflow that uses LangSmith to evaluate retrieval quality from Elasticsearch versus a vector knowledge base, writes the head-to-head scores to a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'analysis'],
      alsoIntegrations: ['langsmith'],
    },
  ],
  skills: [
    {
      name: 'search-elasticsearch-index',
      description: 'Run a query against an Elasticsearch index and return the matching documents.',
      content:
        '# Search Elasticsearch Index\n\nQuery an index and return the relevant documents.\n\n## Steps\n1. Confirm the connection details (host or cloud ID and auth) and the target index name.\n2. Choose the Search operation and build the query DSL — match for full-text, term for exact values, range for numeric or date bounds, and bool to combine clauses.\n3. Set size and offset for paging, add a sort spec when ordering matters, and use source includes/excludes to trim returned fields.\n\n## Output\nReturn the matching hits with their _id, _score, and relevant _source fields, plus the total count and query time. If nothing matched, report zero hits and suggest loosening the query.',
    },
    {
      name: 'index-document',
      description: 'Add or update a document in an Elasticsearch index.',
      content:
        '# Index Document\n\nWrite a document into an Elasticsearch index so it becomes searchable.\n\n## Steps\n1. Confirm the connection details and target index.\n2. Build the document as a JSON object with appropriate field types. Choose the Index Document operation; supply a document ID to upsert a known record, or omit it to let Elasticsearch auto-generate one.\n3. To change only specific fields of an existing document, use Update Document with a partial document and the document ID instead.\n4. Set the refresh policy to immediate or wait-for when the write must be searchable right away.\n\n## Output\nReturn the resulting _id, _version, and the operation result (created or updated).',
    },
    {
      name: 'bulk-load-documents',
      description:
        'Index, update, or delete many Elasticsearch documents in a single bulk request.',
      content:
        '# Bulk Load Documents\n\nApply many document operations to Elasticsearch efficiently in one call.\n\n## Steps\n1. Confirm the connection details and target index.\n2. Assemble the operations as NDJSON: an action line (index, create, update, or delete) followed by the document line where required.\n3. Run the Bulk Operations call and set a refresh policy if the data must be immediately searchable.\n\n## Output\nReport whether any errors occurred and summarize the per-item results — how many succeeded versus failed and the reason for any failures.',
    },
    {
      name: 'check-cluster-health',
      description: 'Report Elasticsearch cluster health and key index statistics.',
      content:
        '# Check Cluster Health\n\nAssess the health of an Elasticsearch deployment.\n\n## Steps\n1. Confirm the connection details.\n2. Call Cluster Health to get the overall status (green, yellow, red) and node count. Optionally wait for a target status.\n3. Use List Indices and Get Index Info to spot oversized, unassigned, or unhealthy indices, and Cluster Stats for storage and shard totals.\n\n## Output\nReport the cluster status, number of nodes, and any indices that look problematic. If status is yellow or red, explain the likely cause (e.g., unassigned replicas) and what to check next.',
    },
  ],
} as const satisfies BlockMeta
