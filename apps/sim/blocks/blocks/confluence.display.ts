import { Search } from '@/components/emcn/icons'
import { ConfluenceIcon, PagerDutyIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const ConfluenceBlockDisplay = {
  type: 'confluence',
  name: 'Confluence (Legacy)',
  description: 'Interact with Confluence',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: ConfluenceIcon,
  longDescription:
    'Integrate Confluence into the workflow. Can read, create, update, delete pages, manage comments, attachments, labels, and search content.',
  docsLink: 'https://docs.sim.ai/integrations/confluence',
  integrationType: IntegrationType.Documents,
  hideFromToolbar: true,
} satisfies BlockDisplay

export const ConfluenceV2BlockDisplay = {
  ...ConfluenceBlockDisplay,
  type: 'confluence_v2',
  name: 'Confluence',
  hideFromToolbar: false,
} satisfies BlockDisplay

export const ConfluenceBlockMeta = {
  tags: ['knowledge-base', 'content-management', 'note-taking'],
  url: 'https://www.atlassian.com/software/confluence',
  templates: [
    {
      icon: PagerDutyIcon,
      title: 'Incident response coordinator',
      prompt:
        'Create a knowledge base connected to my Confluence or Notion with runbooks and incident procedures. Then build a workflow triggered by PagerDuty incidents that searches the runbooks, gathers related Datadog alerts, identifies the on-call rotation, and posts a comprehensive incident brief to Slack.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'engineering', 'automation'],
      alsoIntegrations: ['notion', 'pagerduty', 'datadog', 'slack'],
    },
    {
      icon: ConfluenceIcon,
      title: 'Knowledge base sync',
      prompt:
        'Create a knowledge base connected to my Confluence workspace so all wiki pages are automatically synced and searchable. Then build a scheduled workflow that identifies stale pages not updated in 90 days and sends a Slack reminder to page owners to review them.',
      modules: ['knowledge-base', 'scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'sync', 'team'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: Search,
      title: 'Multi-source knowledge hub',
      prompt:
        'Create a knowledge base and connect it to Confluence, Notion, and Google Drive so all my company documentation is automatically synced, chunked, and embedded. Then deploy a Q&A agent that can answer questions across all sources with citations.',
      modules: ['knowledge-base', 'scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'team', 'sync', 'automation'],
      alsoIntegrations: ['notion', 'google_drive'],
    },
    {
      icon: ConfluenceIcon,
      title: 'Confluence weekly contributor digest',
      prompt:
        'Build a scheduled workflow that aggregates the week’s new and updated Confluence pages, identifies top contributors, and posts a digest to the team Slack channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ConfluenceIcon,
      title: 'Confluence space migration helper',
      prompt:
        'Create a workflow that takes a source Confluence space, copies pages into a target space with rewritten internal links, attachments, and labels, and writes a mapping table for redirects.',
      modules: ['files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'sync'],
    },
    {
      icon: ConfluenceIcon,
      title: 'Confluence question router',
      prompt:
        'Build a workflow that watches a Confluence space for new questions, finds the right SME via labels, pings them on Slack, and updates the question page with a sourced answer once available.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'communication'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: Search,
      title: 'Confluence knowledge assistant',
      prompt:
        'Create a knowledge base synced from a Confluence space, then build a Slack agent that searches Confluence pages to answer team questions, cites the source page, and offers to create a new page when an answer is missing.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'research', 'communication'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'publish-meeting-notes',
      description:
        'Create a Confluence page with structured meeting notes including attendees, decisions, and action items in the right space.',
      content:
        '# Publish Meeting Notes to Confluence\n\nTurn raw meeting notes into a clean, structured Confluence page.\n\n## Steps\n1. Confirm the target space and any parent page.\n2. Structure the notes into sections: attendees, agenda, decisions, and action items with owners.\n3. Create the page with a clear, dated title.\n4. Return the page URL.\n\n## Output\nA confirmation with the new page title and link, plus the list of action items captured.',
    },
    {
      name: 'update-doc-page',
      description:
        'Read an existing Confluence page, apply updates, and save it back, respecting version control to avoid conflicts.',
      content:
        '# Update a Confluence Page\n\nSafely edit an existing documentation page.\n\n## Steps\n1. Read the target page to get its current content and version number.\n2. Apply the requested changes to the body, preserving existing structure and formatting.\n3. Update the page, incrementing the version number by one to avoid optimistic-locking conflicts.\n4. If the update fails on a version conflict, re-read and retry.\n\n## Output\nA confirmation of the updated page with its new version number and link.',
    },
    {
      name: 'search-knowledge',
      description:
        'Search Confluence content for a topic and summarize the most relevant pages with links for quick reference.',
      content:
        '# Search Confluence Knowledge\n\nFind and summarize documentation on a topic.\n\n## Steps\n1. Search content using the topic keywords, optionally scoped to a space.\n2. Read the top matching pages.\n3. Summarize what each page covers and how it relates to the question.\n\n## Output\nA short briefing answering the question, with links to the source pages cited.',
    },
    {
      name: 'collect-page-feedback',
      description:
        'List and summarize comments on a Confluence page so you can triage feedback and open questions.',
      content:
        '# Collect Confluence Page Feedback\n\nGather and organize comments left on a page.\n\n## Steps\n1. Read the target page to confirm its identity.\n2. List all comments on the page.\n3. Group comments into themes: questions, corrections, and approvals.\n\n## Output\nA digest of comment themes with any unresolved questions flagged for follow-up.',
    },
  ],
} as const satisfies BlockMeta
