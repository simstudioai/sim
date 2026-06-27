import { DubIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const DubBlockDisplay = {
  type: 'dub',
  name: 'Dub',
  description: 'Link management with Dub',
  category: 'tools',
  bgColor: '#181C1E',
  icon: DubIcon,
  longDescription:
    'Create, manage, and track short links with Dub. Supports custom domains, UTM parameters, link analytics, and more.',
  docsLink: 'https://docs.sim.ai/integrations/dub',
  integrationType: IntegrationType.DevOps,
} satisfies BlockDisplay

export const DubBlockMeta = {
  tags: ['link-management', 'marketing', 'data-analytics'],
  url: 'https://dub.co',
  templates: [
    {
      icon: DubIcon,
      title: 'Dub short link factory',
      prompt:
        'Build a workflow that takes a destination URL and campaign metadata, creates a tracked short link in Dub with UTM parameters and a custom slug, stores the link in a table, and returns it to the caller for use in outreach and marketing.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation'],
    },
    {
      icon: DubIcon,
      title: 'Campaign link batcher',
      prompt:
        'Create a workflow that reads a table of campaign destinations, upserts a Dub short link for each row with consistent UTM tags, writes the resulting short URL back into the table, and posts a Slack confirmation summarizing how many links were created or refreshed.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DubIcon,
      title: 'Dub analytics digest',
      prompt:
        'Build a scheduled weekly workflow that pulls Dub link analytics — clicks, leads, sales, and top referrers — for active campaigns, writes a narrative summary highlighting winners and decliners, and delivers the digest to Slack with deep links into the Dub dashboard.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'reporting', 'analysis'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DubIcon,
      title: 'Short link hygiene auditor',
      prompt:
        'Create a scheduled monthly workflow that lists all Dub links, checks each destination for 4xx and 5xx responses, flags broken links in a table, and emails the marketing team a remediation list so dead campaign links never go live.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
    },
    {
      icon: DubIcon,
      title: 'Outbound link personalizer',
      prompt:
        'Build a workflow that reads a leads table, generates a per-lead Dub short link with the lead identifier in UTM and metadata, attaches the personalized link to the outreach email body, and tracks delivery in the table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'marketing', 'automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: DubIcon,
      title: 'Release announcement linker',
      prompt:
        'Create a workflow triggered by a GitHub release that creates a Dub short link for the release notes URL, posts the short link to the marketing Slack channel, and stores the mapping of release tag to short link in a tracking table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'devops', 'automation'],
      alsoIntegrations: ['github', 'slack'],
    },
    {
      icon: DubIcon,
      title: 'Top-converting links report',
      prompt:
        'Build a scheduled monthly workflow that pulls Dub analytics grouped by link, ranks top performers by leads and sales, identifies underperformers, writes a narrative report file with recommendations, and shares it with marketing leadership.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'analysis', 'reporting'],
    },
  ],
  skills: [
    {
      name: 'create-tracked-short-link',
      description:
        'Create a Dub short link for a destination URL with UTM parameters and an optional custom slug.',
      content:
        '# Create Tracked Short Link\n\nTurn a long destination URL into a branded, trackable Dub short link.\n\n## Steps\n1. Take the destination URL and any campaign metadata (source, medium, campaign name).\n2. Call Create Link with the URL. Set the UTM source, medium, and campaign fields so clicks attribute correctly, and set a custom slug when a memorable link is wanted.\n3. Add a custom domain, title, or tag IDs if the request specifies them.\n\n## Output\nReturn the full short link URL, its slug, the destination, and the QR code URL. Confirm which UTM parameters were applied.',
    },
    {
      name: 'report-link-analytics',
      description:
        'Pull Dub click, lead, and sales analytics for a link or campaign over a time window.',
      content:
        '# Report Link Analytics\n\nSummarize how a Dub short link or campaign is performing.\n\n## Steps\n1. Choose the Get Analytics operation. Set the event type (clicks, leads, sales, or composite) the request cares about.\n2. Scope to a specific link via link ID or external ID, or to a domain for a whole campaign. Set the interval (e.g., 7d, 30d) or explicit start and end dates.\n3. Set group-by to break results down by country, device, referrer, or top links when a breakdown is asked for; otherwise use count for totals.\n\n## Output\nReport the headline metrics (clicks, leads, sales, revenue) and, when grouped, the top segments. Call out notable winners and decliners versus the prior period when comparison data is available.',
    },
    {
      name: 'batch-create-campaign-links',
      description:
        'Upsert a Dub short link for each row in a list of destinations with consistent UTM tagging.',
      content:
        '# Batch Create Campaign Links\n\nGenerate consistent tracked links for many destinations at once.\n\n## Steps\n1. For each destination URL in the list, build the UTM parameters and slug from the row data so tagging is uniform across the batch.\n2. Use Upsert Link (keyed on external ID or slug) so re-runs refresh rather than duplicate existing links.\n3. Collect the resulting short link for each row.\n\n## Output\nReturn a table mapping each destination to its short link and external ID. Report how many links were created versus refreshed, and flag any rows that failed.',
    },
    {
      name: 'audit-existing-links',
      description:
        'List Dub links and check each destination for broken or stale URLs to flag for cleanup.',
      content:
        '# Audit Existing Links\n\nReview existing Dub links to catch broken or outdated destinations.\n\n## Steps\n1. Call List Links, optionally filtered by domain or tag IDs, paginating until all links are retrieved.\n2. For each link, inspect the destination URL and check it for 4xx or 5xx responses or obviously stale targets.\n3. Note links with low or zero clicks over a long period as candidates for archiving.\n\n## Output\nReturn a remediation list: short link, destination, detected issue (broken, redirecting, stale), and a suggested action. Sort broken links first.',
    },
  ],
} as const satisfies BlockMeta
