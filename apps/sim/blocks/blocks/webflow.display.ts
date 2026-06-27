import { WebflowIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const WebflowBlockDisplay = {
  type: 'webflow',
  name: 'Webflow',
  description: 'Manage Webflow CMS collections',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: WebflowIcon,
  longDescription:
    'Integrates Webflow CMS into the workflow. Can create, get, list, update, or delete items in Webflow CMS collections. Manage your Webflow content programmatically. Can be used in trigger mode to trigger workflows when collection items change or forms are submitted.',
  docsLink: 'https://docs.sim.ai/integrations/webflow',
  integrationType: IntegrationType.Marketing,
  triggerAllowed: true,
} satisfies BlockDisplay

export const WebflowBlockMeta = {
  tags: ['content-management', 'seo'],
  url: 'https://webflow.com',
  templates: [
    {
      icon: WebflowIcon,
      title: 'Webflow lead capture pipeline',
      prompt:
        'Create a workflow that monitors new Webflow form submissions, enriches each lead with company and contact data using Apollo and web search, adds them to a tracking table with a lead score, and sends a Slack notification to the sales team for high-potential leads.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'automation'],
      alsoIntegrations: ['apollo', 'slack'],
    },
    {
      icon: WebflowIcon,
      title: 'Webflow CMS publisher',
      prompt:
        'Create a workflow that reads a draft articles table, generates an SEO-optimized post, publishes it as a Webflow CMS item, and writes the live URL back to the row.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content'],
    },
    {
      icon: WebflowIcon,
      title: 'Webflow form-to-CRM',
      prompt:
        'Build a workflow that watches Webflow form submissions, enriches each with Apollo company data, and pushes qualifying leads into HubSpot with the right owner and source.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['apollo', 'hubspot'],
    },
    {
      icon: WebflowIcon,
      title: 'Webflow content auditor',
      prompt:
        'Create a scheduled monthly workflow that audits Webflow CMS items for missing meta descriptions, broken links, or stale dates, and writes a remediation backlog.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
    },
    {
      icon: WebflowIcon,
      title: 'Webflow CMS backup',
      prompt:
        'Build a scheduled workflow that exports every item from a Webflow CMS collection to S3 nightly with versioning, and writes the backup manifest to a tracking table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'sync'],
      alsoIntegrations: ['s3'],
    },
    {
      icon: WebflowIcon,
      title: 'Webflow product catalog sync',
      prompt:
        'Create a scheduled workflow that mirrors Shopify products and pricing into a Webflow CMS product collection, keeps both in sync, and posts conflict alerts to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['ecommerce', 'sync'],
      alsoIntegrations: ['shopify', 'slack'],
    },
    {
      icon: WebflowIcon,
      title: 'Webflow + Hubspot lead-magnet',
      prompt:
        'Build a workflow that triggers on a Webflow form submission for a lead magnet, sends the asset via Loops, and writes the engagement to the matching HubSpot contact.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'crm'],
      alsoIntegrations: ['loops', 'hubspot'],
    },
  ],
  skills: [
    {
      name: 'publish-cms-item',
      description:
        'Create a new item in a Webflow CMS collection from supplied or generated field data.',
      content:
        '# Publish a Webflow CMS Item\n\nTurn structured content into a live Webflow CMS collection item.\n\n## Steps\n1. Identify the target site and collection. If unknown, list collections to confirm the collection ID and its field schema.\n2. Map the incoming content to the collection fields, including required fields like name and slug. Generate a URL-safe slug if one is not provided.\n3. Call the create-item operation with the assembled fieldData JSON.\n4. Confirm the new item ID and slug returned by the API.\n\n## Output\nReport the created item ID, slug, and the live or staged URL. If a required field was missing, name it explicitly rather than guessing a value.',
    },
    {
      name: 'update-cms-item',
      description:
        'Find a Webflow CMS item and update specific fields without disturbing the rest.',
      content:
        '# Update a Webflow CMS Item\n\nApply targeted edits to an existing collection item.\n\n## Steps\n1. Resolve the item by ID, or list items in the collection and match on slug or name.\n2. Get the current item so existing field values are known.\n3. Build fieldData containing only the fields that change, merged onto the current values so untouched fields are preserved.\n4. Call the update-item operation and confirm the change took effect.\n\n## Output\nList exactly which fields changed and their new values. Note the item ID and whether the change is live or staged.',
    },
    {
      name: 'audit-collection-content',
      description:
        'List items in a Webflow collection and flag missing or stale fields for cleanup.',
      content:
        '# Audit a Webflow Collection\n\nReview a CMS collection for content-quality gaps.\n\n## Steps\n1. List all items in the target collection, paging through with offset and limit until complete.\n2. For each item, check for empty required fields such as meta description, image, or publish date.\n3. Flag items that are missing key SEO or display fields, or whose dates look stale.\n4. Summarize the findings as a remediation backlog.\n\n## Output\nReturn a table of flagged items with item ID, slug, and the specific gap found. End with a short prioritized list of what to fix first.',
    },
  ],
} as const satisfies BlockMeta
