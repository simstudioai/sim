import { ObsidianIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const ObsidianBlockDisplay = {
  type: 'obsidian',
  name: 'Obsidian',
  description: 'Interact with your Obsidian vault via the Local REST API',
  category: 'tools',
  bgColor: '#0F0F0F',
  icon: ObsidianIcon,
  longDescription:
    'Read, create, update, search, and delete notes in your Obsidian vault. Manage periodic notes, execute commands, and patch content at specific locations. Requires the Obsidian Local REST API plugin.',
  docsLink: 'https://docs.sim.ai/integrations/obsidian',
  integrationType: IntegrationType.Documents,
} satisfies BlockDisplay

export const ObsidianBlockMeta = {
  tags: ['note-taking', 'knowledge-base'],
  url: 'https://obsidian.md',
  templates: [
    {
      icon: ObsidianIcon,
      title: 'Obsidian daily journal agent',
      prompt:
        'Build a workflow that pulls calendar events, completed tasks, and journal prompts, and generates a daily Obsidian note draft for the user to review and annotate.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'content'],
      alsoIntegrations: ['google_calendar'],
    },
    {
      icon: ObsidianIcon,
      title: 'Obsidian backlink builder',
      prompt:
        'Create a workflow that processes new Obsidian notes, identifies entities and concepts that should be wikilinks, and rewrites the note with proper backlinks plus a hub note for new tags.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'research'],
    },
    {
      icon: ObsidianIcon,
      title: 'Obsidian web clipper',
      prompt:
        'Build a workflow that accepts a URL from a form, scrapes the page with Firecrawl, summarizes with an agent, and writes the clip as a new Obsidian note with source metadata.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'research'],
      alsoIntegrations: ['firecrawl'],
    },
    {
      icon: ObsidianIcon,
      title: 'Obsidian knowledge-base sync',
      prompt:
        'Create a workflow that mirrors an Obsidian vault into a Sim knowledge base so an agent can answer questions over personal notes with citations.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'research'],
    },
    {
      icon: ObsidianIcon,
      title: 'Obsidian smart review',
      prompt:
        'Build a scheduled weekly workflow that surfaces stale Obsidian notes due for spaced-repetition review, scores their freshness, and writes a review queue note for the user.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'automation'],
    },
    {
      icon: ObsidianIcon,
      title: 'Obsidian meeting-note autopopulator',
      prompt:
        'Create a workflow that runs after a Google Meet meeting, fetches the transcript, and appends a structured meeting note to an Obsidian vault under the right project folder.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'team'],
      alsoIntegrations: ['google_meet'],
    },
    {
      icon: ObsidianIcon,
      title: 'Obsidian reading-list digester',
      prompt:
        'Build a scheduled workflow that reads the links saved in an Obsidian "to read" note, summarizes each article with an agent, and appends the key takeaways back into the vault as individual literature notes with source links.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'research', 'automation'],
    },
  ],
  skills: [
    {
      name: 'capture-note',
      description: 'Create a new Obsidian note with Markdown content at a chosen vault path.',
      content:
        '# Capture Note\n\nWrite a new note into the Obsidian vault.\n\n## Steps\n1. Decide the vault path and filename for the note, keeping folder conventions consistent.\n2. Compose the Markdown body with a clear title heading and any tags or frontmatter wanted.\n3. Run Create Note with the path and content. If the note may already exist, use Append to Note instead to avoid overwriting.\n\n## Output\nConfirm the note path created and summarize what was captured.',
    },
    {
      name: 'append-to-daily-note',
      description: 'Append an entry to the Obsidian periodic daily note.',
      content:
        '# Append to Daily Note\n\nAdd a timestamped entry to the current daily note.\n\n## Steps\n1. Use Get Periodic Note to confirm the daily note exists and read its current content if needed.\n2. Format the entry as a Markdown bullet or section, including a timestamp where useful.\n3. Run Append to Periodic Note to add it to the day.\n\n## Output\nConfirm the entry was appended to the daily note and quote the line added.',
    },
    {
      name: 'search-vault',
      description: 'Search the Obsidian vault for notes matching a query and summarize matches.',
      content:
        '# Search Vault\n\nFind notes in the Obsidian vault that mention a topic.\n\n## Steps\n1. Run Search with the query terms.\n2. Open the most relevant results with Get Note to read their content.\n3. Summarize the findings, linking each note by its path.\n\n## Output\nA short synthesis of what the vault says about the topic, with the source note paths listed.',
    },
  ],
} as const satisfies BlockMeta
