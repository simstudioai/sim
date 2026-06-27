import { EvernoteIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const EvernoteBlockDisplay = {
  type: 'evernote',
  name: 'Evernote',
  description: 'Manage notes, notebooks, and tags in Evernote',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: EvernoteIcon,
  longDescription:
    'Integrate with Evernote to manage notes, notebooks, and tags. Create, read, update, copy, search, and delete notes. Create and list notebooks and tags.',
  docsLink: 'https://docs.sim.ai/integrations/evernote',
  integrationType: IntegrationType.Documents,
} satisfies BlockDisplay

export const EvernoteBlockMeta = {
  tags: ['note-taking', 'knowledge-base'],
  url: 'https://evernote.com',
  templates: [
    {
      icon: EvernoteIcon,
      title: 'Evernote to knowledge base sync',
      prompt:
        'Build a workflow that syncs Evernote notebooks into a knowledge base on a schedule so all notes and clipped web pages become searchable by an agent.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'research'],
    },
    {
      icon: EvernoteIcon,
      title: 'Evernote weekly summary',
      prompt:
        'Create a scheduled weekly workflow that summarizes new Evernote notes by tag, writes the summary as a Markdown file, and emails it to the user as a knowledge digest.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: EvernoteIcon,
      title: 'Evernote action-item extractor',
      prompt:
        'Build a workflow that searches Evernote for recently created notes, extracts action items and due dates with an agent, and creates a matching task in Asana for each.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'automation'],
      alsoIntegrations: ['asana'],
    },
    {
      icon: EvernoteIcon,
      title: 'Evernote research collector',
      prompt:
        'Create a workflow that takes web clippings saved to Evernote, classifies by topic, and writes structured rows to a research table for downstream analysis.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'research'],
    },
    {
      icon: EvernoteIcon,
      title: 'Evernote tag auto-organizer',
      prompt:
        'Build a workflow that scans new Evernote notes, suggests and applies tags based on content, and writes the tag changes to an audit log for review.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'automation'],
    },
    {
      icon: EvernoteIcon,
      title: 'Evernote to Notion migrator',
      prompt:
        'Create a workflow that imports an Evernote notebook into Notion as pages in a chosen database, preserving formatting, attachments, and tags.',
      modules: ['files', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'sync'],
      alsoIntegrations: ['notion'],
    },
    {
      icon: EvernoteIcon,
      title: 'Evernote research-assistant agent',
      prompt:
        'Build an agent that searches across the user’s Evernote notebooks for grounded answers with citations, and saves the answer plus sources back as a new Evernote note.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'research'],
    },
  ],
  skills: [
    {
      name: 'create-evernote-note',
      description: 'Create a new Evernote note with a title, content, tags, and target notebook.',
      content:
        '# Create Evernote Note\n\nSave new content as a note in Evernote.\n\n## Steps\n1. Confirm the note title and content. Plain text is fine; the content is stored as ENML.\n2. Choose the Create Note operation. To file it in a specific notebook, resolve the notebook GUID with List Notebooks and pass it.\n3. Add comma-separated tag names so the note is findable later.\n\n## Output\nReturn the new note GUID, its title, and the notebook and tags it was saved under.',
    },
    {
      name: 'search-evernote-notes',
      description:
        'Search Evernote for notes matching a query and return their titles and metadata.',
      content:
        '# Search Evernote Notes\n\nFind notes across Evernote using its search grammar.\n\n## Steps\n1. Build a query using Evernote search syntax — e.g., tag:work, intitle:meeting, notebook scoping, or plain keywords.\n2. Run Search Notes. Scope to a notebook GUID when the location is known, and set max results and offset to page through matches.\n3. For any note you need the body of, call Get Note with its GUID and include content.\n\n## Output\nReturn the matching notes with title, GUID, and notebook, plus the total match count. If a note body is needed, include its retrieved content.',
    },
    {
      name: 'extract-note-action-items',
      description: 'Read recent Evernote notes and extract action items, owners, and due dates.',
      content:
        '# Extract Note Action Items\n\nPull tasks out of meeting notes or research notes in Evernote.\n\n## Steps\n1. Use Search Notes to find the relevant recent notes (e.g., by tag or notebook).\n2. For each match, call Get Note with content to read the full body.\n3. Identify action items, the responsible owner, and any due dates mentioned in the text.\n\n## Output\nReturn a structured list of action items, each with its owner, due date if stated, and a link back to the source note GUID. Flag items with no clear owner.',
    },
    {
      name: 'organize-notes-with-tags',
      description: 'Create tags and apply them to Evernote notes to keep them organized.',
      content:
        '# Organize Notes with Tags\n\nKeep Evernote notes structured by tagging them consistently.\n\n## Steps\n1. Call List Tags to see existing tags and avoid duplicates. Create any missing tag with Create Tag (optionally nested under a parent tag).\n2. For each note to organize, read it with Get Note if needed, decide the right tags from its content, and apply them via Update Note with the tag names.\n3. Keep tag names consistent in casing and wording across notes.\n\n## Output\nReturn each note GUID with the tags applied and note any new tags that were created.',
    },
  ],
} as const satisfies BlockMeta
