import { BookOpen } from '@/components/emcn/icons'
import { GoogleDriveIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const GoogleDriveBlockDisplay = {
  type: 'google_drive',
  name: 'Google Drive',
  description: 'Manage files, folders, and permissions',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: GoogleDriveIcon,
  longDescription:
    'Integrate Google Drive into the workflow. Can create, upload, download, copy, move, delete, share files and manage permissions.',
  docsLink: 'https://docs.sim.ai/integrations/google_drive',
  integrationType: IntegrationType.Documents,
} satisfies BlockDisplay

export const GoogleDriveBlockMeta = {
  tags: ['cloud', 'google-workspace', 'document-processing'],
  url: 'https://workspace.google.com/products/drive',
  templates: [
    {
      icon: BookOpen,
      title: 'Personal knowledge assistant',
      prompt:
        'Create a knowledge base and connect it to my Google Drive, Notion, or Obsidian so all my notes, docs, and articles are automatically synced and embedded. Then build an agent that I can ask anything — it should answer with citations and deploy as a chat endpoint.',
      modules: ['knowledge-base', 'agent'],
      category: 'productivity',
      tags: ['individual', 'research', 'team'],
      alsoIntegrations: ['notion', 'obsidian'],
    },
    {
      icon: GoogleDriveIcon,
      title: 'Google Drive knowledge search',
      prompt:
        'Create a knowledge base connected to my Google Drive so all documents, spreadsheets, and presentations are automatically synced and searchable. Then build an agent I can ask things like "find the board deck from last quarter" or "what were the KPIs in the marketing plan?" and get answers with doc links.',
      modules: ['knowledge-base', 'agent'],
      category: 'productivity',
      tags: ['individual', 'team', 'research'],
    },
    {
      icon: GoogleDriveIcon,
      title: 'Google Drive contract intake',
      prompt:
        'Create a workflow that watches a Google Drive intake folder for new contract PDFs, extracts clauses with Reducto, writes structured terms to a table, and pings legal in Slack.',
      modules: ['files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'automation'],
      alsoIntegrations: ['reducto', 'slack'],
    },
    {
      icon: GoogleDriveIcon,
      title: 'Google Drive new-hire kit deployer',
      prompt:
        'Build a workflow triggered by a new hire in Greenhouse that copies the standard Google Drive onboarding folder, shares it with the new hire, and writes the link into the onboarding tracker.',
      modules: ['files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'automation'],
      alsoIntegrations: ['greenhouse'],
    },
    {
      icon: GoogleDriveIcon,
      title: 'Google Drive retention enforcer',
      prompt:
        'Create a scheduled monthly workflow that finds Google Drive files past the retention horizon, requires owner approval over Slack, and archives or deletes per the policy.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleDriveIcon,
      title: 'Drive intake auto-filer',
      prompt:
        "Build a workflow that watches a Google Drive intake folder for new uploads, reads each file's content to classify it by type and customer, creates the right destination folder, and moves the file there with a renamed, consistent filename.",
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'document-processing'],
    },
    {
      icon: BookOpen,
      title: 'Drive document Q&A assistant',
      prompt:
        'Create a knowledge base synced from a Google Drive folder, then build an agent that searches the synced documents to answer team questions and replies with the answer plus a link to the source file in Drive.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'research', 'sync'],
    },
  ],
  skills: [
    {
      name: 'find-file-in-drive',
      description:
        'Search Google Drive with query syntax to locate files by name, type, content, or date.',
      content:
        "# Find a File in Drive\n\nLocate files using Drive query syntax.\n\n## Steps\n1. Translate the request into a Drive query. Common clauses: `name contains 'term'`, `fullText contains 'term'`, `mimeType = 'application/pdf'`, `modifiedTime > '2024-01-01T00:00:00'`, `'email' in owners`, `trashed = false`.\n2. Run the Search Files operation with that query and a Results Per Page value.\n3. If results are too broad, add `and` clauses (file type, owner, date) to narrow.\n4. For a chosen result, run Get File Info for full metadata.\n\n## Output\nA list of matching files: name, type, owner, modified date, and the file ID. Highlight the single best match if the intent was specific.",
    },
    {
      name: 'organize-files-into-folders',
      description:
        'Create folders and move or copy files in Google Drive to keep storage organized.',
      content:
        '# Organize Files into Folders\n\nFile and tidy Drive content.\n\n## Steps\n1. Identify the target structure: which folder should exist and what goes in it.\n2. If the destination folder does not exist, run Create Folder (set its parent if needed) and capture the new folder ID.\n3. For each file to relocate, run Move File with the destination folder ID. Use Copy File instead when the original must stay in place.\n4. Optionally run Update File to rename files to a consistent convention.\n\n## Output\nA summary of what was created and moved: destination folder link, count of files relocated, and any renames applied.',
    },
    {
      name: 'share-file-with-people',
      description:
        'Grant access to a Google Drive file for users, groups, a domain, or anyone with the link.',
      content:
        '# Share a File\n\nGrant access to a Drive file with the right permission level.\n\n## Steps\n1. Obtain the file ID (select it or run Search Files).\n2. Decide the share target: a specific user/group email, an entire domain, or anyone with the link.\n3. Choose the permission level: Viewer (reader), Commenter, or Editor (writer).\n4. Run the Share File operation with the target and role. For user/group shares, optionally include a notification message.\n\n## Output\nConfirm who now has access and at what level, plus the file link. Avoid `anyone` unless explicitly requested.',
    },
    {
      name: 'read-file-content',
      description:
        'Extract the text content of a Google Drive file, exporting Workspace files to a usable format.',
      content:
        '# Read File Content\n\nPull the text out of a Drive file for downstream use.\n\n## Steps\n1. Obtain the file ID.\n2. Run the Get File Content operation. For Google Docs/Sheets/Slides, set Export Format (Auto picks the best, or choose Plain Text / PDF / DOCX explicitly).\n3. For non-Workspace files (PDF, TXT), the content is returned directly.\n4. Use the returned text for summarization, extraction, or indexing.\n\n## Output\nReturn the extracted content (or a summary of it if large), noting the file name and the export format used.',
    },
  ],
} as const satisfies BlockMeta
