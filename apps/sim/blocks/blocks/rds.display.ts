import { RDSIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const RDSBlockDisplay = {
  type: 'rds',
  name: 'Amazon RDS',
  description: 'Connect to Amazon RDS via Data API',
  category: 'tools',
  bgColor: 'linear-gradient(45deg, #2E27AD 0%, #527FFF 100%)',
  icon: RDSIcon,
  iconColor: '#527FFF',
  longDescription:
    'Integrate Amazon RDS Aurora Serverless into the workflow using the Data API. Can query, insert, update, delete, and execute raw SQL without managing database connections.',
  docsLink: 'https://docs.sim.ai/integrations/rds',
  integrationType: IntegrationType.Databases,
} satisfies BlockDisplay

export const RDSBlockMeta = {
  tags: ['cloud'],
  url: 'https://aws.amazon.com/rds',
  templates: [
    {
      icon: RDSIcon,
      title: 'RDS daily metrics digest',
      prompt:
        'Build a scheduled workflow that runs an aggregate SQL query against my Amazon RDS database each morning, summarizes the key numbers with an agent, and posts the digest to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: RDSIcon,
      title: 'RDS natural-language query agent',
      prompt:
        'Create an agent that introspects my Amazon RDS schema, turns plain-English questions into SQL, runs the query through the Data API, and returns the results in a readable answer.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'analysis'],
    },
    {
      icon: RDSIcon,
      title: 'RDS lead capture',
      prompt:
        'Build a workflow triggered by a form submission that validates the payload and inserts a new lead row into my Amazon RDS database, then confirms the write back to the submitter.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'forms'],
    },
    {
      icon: RDSIcon,
      title: 'RDS to spreadsheet export',
      prompt:
        'Create a scheduled workflow that queries Amazon RDS for the latest records, writes the rows into a Sim table, and keeps a running export the operations team can review.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'sync'],
    },
    {
      icon: RDSIcon,
      title: 'RDS record updater from Slack',
      prompt:
        'Build a workflow that reads update requests posted in a Slack channel, parses the target record and fields with an agent, and runs the matching UPDATE against Amazon RDS with the conditions applied.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: RDSIcon,
      title: 'RDS row-change alerter',
      prompt:
        'Create a scheduled workflow that queries Amazon RDS for rows matching a watch condition, compares them to the previous run stored in a table, and posts a Slack alert when a tracked record changes.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: RDSIcon,
      title: 'RDS + BigQuery analytics mirror',
      prompt:
        'Build a scheduled workflow that queries analytical tables from Amazon RDS, loads the rows into BigQuery for downstream BI, and writes a sync log to a table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['analysis', 'sync'],
      alsoIntegrations: ['google_bigquery'],
    },
  ],
  skills: [
    {
      name: 'run-readonly-query',
      description:
        'Run a parameterized SELECT against Amazon RDS via the Data API and return the rows.',
      content:
        '# Run Read-only Query\n\nQuery an RDS database through the Data API to answer a question.\n\n## Steps\n1. Write a SELECT statement that returns only the columns needed.\n2. Use parameters for any user-supplied values instead of string concatenation.\n3. Execute the statement and collect the result rows.\n\n## Output\nThe returned rows in a readable table plus a row count. If the result is large, summarize and note that it was limited.',
    },
    {
      name: 'lookup-record',
      description:
        'Fetch a specific record from Amazon RDS by an identifier and return its fields.',
      content:
        '# Lookup Record\n\nRetrieve one row from an RDS table by a key.\n\n## Steps\n1. Identify the table and the unique identifier (id, email, order number).\n2. Run a parameterized SELECT filtered by that identifier.\n3. Return the matching row, or report that no record was found.\n\n## Output\nThe record fields if found, or a clear "not found" result. Do not invent field values.',
    },
    {
      name: 'insert-record',
      description:
        'Insert a new row into an Amazon RDS table from provided field values via the Data API.',
      content:
        '# Insert Record\n\nWrite a new record into an RDS table through the Data API.\n\n## Steps\n1. Identify the target table and map the input values to its columns as key-value pairs.\n2. Run the insert operation with that data object.\n3. To load several rows, repeat the insert for each item, or use the Execute Raw SQL operation with a multi-row INSERT statement.\n\n## Output\nConfirm the table written to and how many rows were inserted. Flag any items skipped for missing required fields.',
    },
  ],
} as const satisfies BlockMeta
