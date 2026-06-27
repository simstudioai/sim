import { Send } from '@/components/emcn/icons'
import { NotionIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const NotionBlockDisplay = {
  type: 'notion',
  name: 'Notion (Legacy)',
  description: 'Manage Notion pages',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: NotionIcon,
  longDescription:
    'Integrate with Notion into the workflow. Can read page, read database, create page, create database, append content, query database, and search workspace.',
  docsLink: 'https://docs.sim.ai/integrations/notion',
  integrationType: IntegrationType.Documents,
  hideFromToolbar: true,
} satisfies BlockDisplay

export const NotionV2BlockDisplay = {
  type: 'notion_v2',
  name: 'Notion',
  description: 'Manage Notion pages',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: NotionIcon,
  longDescription:
    'Integrate with Notion into the workflow. Can read page, read database, create page, create database, append content, query database, and search workspace.',
  docsLink: 'https://docs.sim.ai/integrations/notion',
  integrationType: IntegrationType.Documents,
  hideFromToolbar: false,
} satisfies BlockDisplay

export const NotionBlockMeta = {
  tags: ['note-taking', 'knowledge-base', 'content-management'],
  url: 'https://www.notion.com',
  templates: [
    {
      icon: Send,
      title: 'Customer support bot',
      prompt:
        'Create a knowledge base and connect it to my Notion or Google Docs so it stays synced with my product documentation automatically. Then build an agent that answers customer questions using it with sourced citations and deploy it as a chat endpoint.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'communication', 'automation'],
      alsoIntegrations: ['google_docs'],
    },
    {
      icon: NotionIcon,
      title: 'Notion knowledge search',
      prompt:
        'Create a knowledge base connected to my Notion workspace so all pages, databases, meeting notes, and wikis are automatically synced and searchable. Then build an agent I can ask things like "what\'s our refund policy?" or "what was decided in the Q3 planning doc?" and get instant answers with page links.',
      modules: ['knowledge-base', 'agent'],
      category: 'productivity',
      tags: ['team', 'research'],
    },

    {
      icon: NotionIcon,
      title: 'Notify your team from Notion',
      prompt:
        'Build a workflow that watches Notion for new or updated pages and automatically posts a Slack message so your team stays aligned without manual check-ins.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['automation', 'communication'],
      featured: true,
      alsoIntegrations: ['slack'],
    },
    {
      icon: NotionIcon,
      title: 'Notion meeting-notes capture',
      prompt:
        'Build a workflow that runs after a Google Meet call, fetches the transcript, and creates a structured Notion page under the right project with attendees, decisions, and action items.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'note-taking', 'automation'],
      alsoIntegrations: ['google_meet'],
    },
    {
      icon: NotionIcon,
      title: 'Notion CRM enrichment',
      prompt:
        'Create a workflow that watches a Notion database of companies, researches each new entry for funding, headcount, and industry, and appends the enriched fields back to the Notion page so the pipeline stays current.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'enrichment', 'automation'],
    },
    {
      icon: NotionIcon,
      title: 'Notion content calendar publisher',
      prompt:
        'Build a scheduled workflow that queries a Notion content-calendar database for posts marked ready today, formats each one, and publishes it to the blog while updating the Notion page status to published.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content-management', 'automation'],
      alsoIntegrations: ['wordpress'],
    },
    {
      icon: NotionIcon,
      title: 'Notion weekly digest builder',
      prompt:
        'Create a scheduled weekly workflow that queries a Notion project database for items completed this week, appends a summary section to a Notion review page, and posts the highlights to Slack for the team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting', 'automation'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'create-structured-page',
      description:
        'Create a Notion page under a parent with headings, bullets, and a clean layout.',
      content:
        '# Create Structured Page\n\nCreate a well-formatted Notion page, such as meeting notes or a project brief.\n\n## Steps\n1. Identify the parent page or database, using Search Workspace if the destination is not known.\n2. Run Create Page with the title and parent.\n3. Use Append Content to add the body as Notion blocks: headings for sections, bulleted lists for items, and to-do blocks for action items.\n\n## Output\nReturn the new page URL and id. Summarize the sections that were added.',
    },
    {
      name: 'add-database-entry',
      description: 'Add a row to a Notion database with the correct property values.',
      content:
        '# Add Database Entry\n\nInsert a new row into a Notion database with its properties set.\n\n## Steps\n1. Run Read Database on the target database to learn its property names and types.\n2. Map the requested values to the matching properties, formatting select, date, and relation fields correctly.\n3. Run Add Database Row with the property values.\n\n## Output\nConfirm the new row id and URL, and list the property values that were written.',
    },
    {
      name: 'query-database',
      description: 'Filter and sort a Notion database to return matching entries.',
      content:
        '# Query Database\n\nRetrieve entries from a Notion database that match a condition.\n\n## Steps\n1. Read the database with Read Database to confirm the property to filter on.\n2. Build a filter and optional sort for the requested condition (for example Status equals Done, sorted by date).\n3. Run Query Database and collect the matching pages.\n\n## Output\nA list of matching entries with their key properties and page links. Note the total count.',
    },
    {
      name: 'search-and-summarize',
      description: 'Search the Notion workspace for a topic and summarize the relevant pages.',
      content:
        '# Search and Summarize\n\nFind and summarize Notion content on a given topic.\n\n## Steps\n1. Run Search Workspace with the topic keywords.\n2. Read the most relevant pages with Read Page.\n3. Synthesize the key points across the pages, citing each source page by title and link.\n\n## Output\nA short synthesized answer with citations to the Notion pages used. Note if the workspace had no relevant content.',
    },
  ],
} as const satisfies BlockMeta

export const NotionV2BlockMeta = {
  tags: ['note-taking', 'knowledge-base', 'content-management'],
  url: 'https://www.notion.com',
} as const satisfies BlockMeta
