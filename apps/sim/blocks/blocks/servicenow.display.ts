import { ServiceNowIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const ServiceNowBlockDisplay = {
  type: 'servicenow',
  name: 'ServiceNow',
  description: 'Create, read, update, and delete ServiceNow records',
  category: 'tools',
  bgColor: '#032D42',
  icon: ServiceNowIcon,
  longDescription:
    'Integrate ServiceNow into your workflow. Create, read, update, and delete records in any ServiceNow table including incidents, tasks, change requests, users, and more.',
  docsLink: 'https://docs.sim.ai/integrations/servicenow',
  integrationType: IntegrationType.Support,
} satisfies BlockDisplay

export const ServiceNowBlockMeta = {
  tags: ['customer-support', 'ticketing', 'incident-management'],
  url: 'https://www.servicenow.com',
  templates: [
    {
      icon: ServiceNowIcon,
      title: 'ServiceNow incident commander',
      prompt:
        'Build a workflow triggered when a ServiceNow incident is created at P1 or P2 that opens a Slack war-room channel, posts the incident description and impacted CI, invites the assignment group, and keeps the channel topic in sync with the incident state.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'automation', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ServiceNowIcon,
      title: 'ServiceNow change request analyzer',
      prompt:
        'Create a workflow that reads new ServiceNow change requests, scores risk based on affected services, blackout windows, and change history, and updates the change record with a recommended approver chain and a risk justification note.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'analysis', 'devops'],
    },
    {
      icon: ServiceNowIcon,
      title: 'ServiceNow knowledge sync',
      prompt:
        'Build a scheduled workflow that pulls Confluence pages tagged for IT operations and creates or updates matching ServiceNow knowledge articles, mapping categories and authors so the knowledge base stays in sync without manual copy-paste.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'sync', 'team'],
      alsoIntegrations: ['confluence'],
    },
    {
      icon: ServiceNowIcon,
      title: 'ServiceNow asset audit',
      prompt:
        'Create a scheduled workflow that queries the ServiceNow CMDB for assets missing owner, lifecycle, or last-discovered fields, flags stale or orphaned records in a tracking table, and opens remediation tasks against the responsible group.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'monitoring', 'analysis'],
    },
    {
      icon: ServiceNowIcon,
      title: 'ServiceNow ticket auto-classifier',
      prompt:
        'Build a workflow triggered by new ServiceNow incidents that classifies category and subcategory, sets impact and urgency, infers the affected service from the description, and routes the ticket to the right assignment group.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'automation', 'support'],
    },
    {
      icon: ServiceNowIcon,
      title: 'ServiceNow weekly ops digest',
      prompt:
        'Create a scheduled weekly workflow that pulls ServiceNow incident, change, and request data, calculates MTTR, change success rate, and top failing services, and posts a digest to Slack with the standout records linked.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'reporting', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ServiceNowIcon,
      title: 'ServiceNow ticket deflection bot',
      prompt:
        'Build a Slack bot that lets employees report IT issues in natural language, reads similar resolved ServiceNow records to suggest a fix first, and only creates a new ServiceNow incident record with the right category when self-service does not resolve it.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'create-incident',
      description:
        'Create a new ServiceNow incident record with the right category, priority, and description.',
      content:
        '# Create Incident\n\nFile a new ServiceNow incident from a reported issue.\n\n## Steps\n1. Use the Create Record operation against the incident table.\n2. Populate the field values: a clear short description, the longer description, category, and priority or impact and urgency.\n3. Set caller or assignment group fields when known.\n\n## Output\nReturn the created record sys_id and incident number so the reporter can track it, and echo the category and priority that were set.',
    },
    {
      name: 'search-records',
      description:
        'Query a ServiceNow table for records matching a condition and return the matching rows.',
      content:
        '# Search Records\n\nFind records in any ServiceNow table that match a condition.\n\n## Steps\n1. Use the Read Records operation against the target table (for example incident, change_request, or sc_task).\n2. Provide an encoded query to filter (for example active incidents in a category) and limit the number of rows returned.\n3. Choose the display-value setting so returned fields are human-readable rather than raw sys_ids when needed.\n\n## Output\nReturn the matched records with their key fields and sys_ids, and report how many matched the query.',
    },
    {
      name: 'update-record-status',
      description:
        'Update fields on an existing ServiceNow record, such as state, assignment, or work notes.',
      content:
        '# Update Record Status\n\nModify an existing ServiceNow record once a decision or action is taken.\n\n## Steps\n1. Identify the record by its sys_id (from a search step or a notification).\n2. Use the Update Record operation against the correct table, supplying only the fields to change such as state, assigned_to, or work_notes.\n3. Confirm the change by reading the record back.\n\n## Output\nConfirm the record number, the fields that changed, and their new values so the update is auditable.',
    },
  ],
} as const satisfies BlockMeta
