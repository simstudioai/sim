import { GoogleDocsIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const GoogleDocsBlockDisplay = {
  type: 'google_docs',
  name: 'Google Docs',
  description: 'Read, write, and create documents',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: GoogleDocsIcon,
  longDescription:
    'Integrate Google Docs into the workflow. Can read, write, and create documents.',
  docsLink: 'https://docs.sim.ai/integrations/google_docs',
  integrationType: IntegrationType.Documents,
} satisfies BlockDisplay

export const GoogleDocsBlockMeta = {
  tags: ['google-workspace', 'document-processing', 'content-management'],
  url: 'https://www.google.com/docs/about',
  templates: [
    {
      icon: GoogleDocsIcon,
      title: 'Google Docs review request',
      prompt:
        'Build a workflow that reads a Google Doc when its title is marked ready for review, summarizes the key points with an agent, and posts a review request with the doc link to the named reviewers in Slack.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleDocsIcon,
      title: 'Google Docs change digester',
      prompt:
        'Create a scheduled weekly workflow that reads each tracked Google Doc, compares its content against the snapshot stored in a table, summarizes what changed with an agent, and posts a digest to the team in Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleDocsIcon,
      title: 'Google Docs translation copy',
      prompt:
        'Build a workflow that takes a Google Docs document and creates translated copies into target languages with Google Translate, links them in the source, and notifies the localization team.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['content', 'enterprise'],
      alsoIntegrations: ['google_translate'],
    },
    {
      icon: GoogleDocsIcon,
      title: 'Meeting notes to Google Docs',
      prompt:
        'Create a workflow that after a meeting pulls the transcript, summarizes decisions, action items, and owners with an agent, and creates a formatted Google Docs document in the shared team folder with a link posted to Slack.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'meeting', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleDocsIcon,
      title: 'Google Docs proposal generator',
      prompt:
        'Build a workflow that on a closed-won deal reads the account details, creates a Google Docs document from the proposal template, fills in customer name, scope, and pricing, and shares the draft with the account owner for review.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'content', 'automation'],
    },
    {
      icon: GoogleDocsIcon,
      title: 'Weekly report writer',
      prompt:
        'Create a scheduled weekly workflow that reads metrics from my tables, writes a narrative status report with an agent, and appends the new section to a running Google Docs document so leadership has one living record.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'analysis'],
    },
    {
      icon: GoogleDocsIcon,
      title: 'Google Docs knowledge sync',
      prompt:
        'Build a workflow that reads a set of Google Docs in a folder, extracts their content, and upserts it into a knowledge base so the team can ask questions and get answers grounded in the latest docs.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'research', 'sync'],
    },
  ],
  skills: [
    {
      name: 'create-document-from-content',
      description: 'Create a new Google Doc with a title and formatted content in a chosen folder.',
      content:
        '# Create a Document from Content\n\nGenerate a new Google Doc from supplied or drafted content.\n\n## Steps\n1. Determine the document title and the body content from the request.\n2. If the content uses headings, bold, lists, tables, or links, enable the Markdown option so it renders as formatted Doc content; otherwise leave it off for plain text.\n3. Optionally set the parent folder ID to file the doc in the right place.\n4. Run the Create Document operation with the title, content, and folder.\n\n## Output\nConfirm creation and return the document ID and link. If a folder was specified, confirm it was placed there.',
    },
    {
      name: 'summarize-document',
      description:
        'Read a Google Doc and produce a concise summary with key points and action items.',
      content:
        '# Summarize a Document\n\nRead a Doc and distill it.\n\n## Steps\n1. Obtain the document ID (select the doc or pass its ID).\n2. Run the Read Document operation to pull the full text.\n3. Identify the main thesis, key points, decisions, and any action items or owners.\n4. Keep the summary faithful to the source; do not invent details not present.\n\n## Output\nA short summary: a one-line gist, 3-6 bullet key points, and an Action Items section (owner + task) if any exist. Reference the doc link.',
    },
    {
      name: 'append-to-document',
      description:
        'Write additional content into an existing Google Doc, such as a running log or report section.',
      content:
        '# Append to a Document\n\nAdd a new section to an existing Doc.\n\n## Steps\n1. Obtain the target document ID.\n2. Draft the content to add, clearly delimited (e.g., a dated heading for a running log).\n3. Run the Write to Document operation with the document ID and the new content.\n4. For recurring updates, prefix each entry with a date or section header so the doc stays organized.\n\n## Output\nConfirm the content was written and return the document link. Summarize in one line what was appended.',
    },
  ],
} as const satisfies BlockMeta
