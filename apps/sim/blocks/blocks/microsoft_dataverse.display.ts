import { MicrosoftDataverseIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const MicrosoftDataverseBlockDisplay = {
  type: 'microsoft_dataverse',
  name: 'Microsoft Dataverse',
  description: 'Manage records in Microsoft Dataverse tables',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: MicrosoftDataverseIcon,
  longDescription:
    'Integrate Microsoft Dataverse into your workflow. Create, read, update, delete, upsert, associate, query, search, and execute actions and functions against Dataverse tables using the Web API. Supports bulk operations, FetchXML, file uploads, and relevance search. Works with Dynamics 365, Power Platform, and custom Dataverse environments.',
  docsLink: 'https://docs.sim.ai/integrations/microsoft_dataverse',
  integrationType: IntegrationType.Databases,
} satisfies BlockDisplay

export const MicrosoftDataverseBlockMeta = {
  tags: ['microsoft-365', 'data-warehouse', 'cloud'],
  url: 'https://www.microsoft.com/power-platform/dataverse',
  templates: [
    {
      icon: MicrosoftDataverseIcon,
      title: 'Dataverse record sync',
      prompt:
        'Build a scheduled workflow that mirrors records between Microsoft Dataverse and a Sim table, normalizes schemas, and posts conflict reports to Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'sync'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: MicrosoftDataverseIcon,
      title: 'Dataverse approval workflow',
      prompt:
        'Create a scheduled workflow that polls Dataverse for new high-value records, posts an adaptive card approval to Microsoft Teams, captures the decision, and updates the record.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'automation'],
      alsoIntegrations: ['microsoft_teams'],
    },
    {
      icon: MicrosoftDataverseIcon,
      title: 'Dataverse data-quality auditor',
      prompt:
        'Build a scheduled workflow that scans Dataverse tables for missing required fields, format violations, and duplicates, and writes a remediation backlog to a tracking table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'analysis'],
    },
    {
      icon: MicrosoftDataverseIcon,
      title: 'Dataverse + Power BI feeder',
      prompt:
        'Create a workflow that pulls Dataverse entity data daily, transforms it into BI-ready rows in a Sim table, and stages a refresh signal for downstream Power BI consumption.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'enterprise'],
    },
    {
      icon: MicrosoftDataverseIcon,
      title: 'Dataverse legacy CRM bridge',
      prompt:
        'Build a workflow that mirrors Salesforce contacts into Microsoft Dataverse and back, mapping fields and resolving conflicts deterministically so both CRMs stay in sync during migration.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['crm', 'sync', 'enterprise'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: MicrosoftDataverseIcon,
      title: 'Dataverse compliance archiver',
      prompt:
        'Create a scheduled workflow that exports Dataverse records older than the retention horizon into long-term storage, removes them from the live table, and writes the archive manifest for auditors.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
    {
      icon: MicrosoftDataverseIcon,
      title: 'Dataverse case-routing agent',
      prompt:
        'Build a workflow that runs a relevance search across Microsoft Dataverse case and account tables when a new support request arrives, classifies the issue, upserts the case record with the right owner and priority, and notifies the assigned team in Microsoft Teams.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'enterprise', 'automation'],
      alsoIntegrations: ['microsoft_teams'],
    },
  ],
  skills: [
    {
      name: 'upsert-record',
      description: 'Create or update a record in a Dataverse table by its key without duplicating.',
      content:
        '# Upsert Record\n\nKeep a Dataverse table in sync from an external source without creating duplicates.\n\n## Steps\n1. Identify the target table and the key field that uniquely identifies the record.\n2. Map the incoming data to the table column names.\n3. Use Upsert Record so an existing match is updated and a new key creates a record.\n\n## Output\nThe record ID and whether it was created or updated, plus the fields written.',
    },
    {
      name: 'query-records',
      description: 'List or query Dataverse records with filters and return the matching rows.',
      content:
        '# Query Records\n\nRetrieve a filtered set of rows from a Dataverse table.\n\n## Steps\n1. Choose the table to query.\n2. Use List Records with OData filters, selected columns, and ordering, or use a FetchXML Query for complex joins and aggregates.\n3. Page through results until the needed rows are collected.\n\n## Output\nThe matching records with the selected columns, ready for downstream processing.',
    },
    {
      name: 'relevance-search',
      description:
        'Run a relevance search across Dataverse tables to find records matching a term.',
      content:
        '# Relevance Search\n\nFind records across Dataverse using full-text relevance search.\n\n## Steps\n1. Take the search term, such as a customer name or case keyword.\n2. Use Search with the term, choosing simple or Lucene query syntax and match-any or match-all behavior.\n3. Review the ranked matches and pick the relevant record.\n\n## Output\nA ranked list of matching records with their table and key fields.',
    },
    {
      name: 'bulk-write-records',
      description: 'Create or update many Dataverse records in one batch operation.',
      content:
        '# Bulk Write Records\n\nWrite many Dataverse rows efficiently in a single call.\n\n## Steps\n1. Assemble the array of records, mapping each to the table column names.\n2. Use Create Multiple to insert new rows, or Update Multiple to change existing rows by ID.\n3. Verify the operation succeeded and capture any per-record errors.\n\n## Output\nThe count of records written, their IDs, and any rows that failed with their error.',
    },
  ],
} as const satisfies BlockMeta
