import { DropboxIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const DropboxBlockDisplay = {
  type: 'dropbox',
  name: 'Dropbox',
  description: 'Upload, download, share, and manage files in Dropbox',
  category: 'tools',
  bgColor: '#0061FF',
  icon: DropboxIcon,
  iconColor: '#0061FF',
  longDescription:
    'Integrate Dropbox into your workflow for file management, sharing, and collaboration. Upload files, download content, create folders, manage shared links, and more.',
  docsLink: 'https://docs.sim.ai/integrations/dropbox',
  integrationType: IntegrationType.Documents,
} satisfies BlockDisplay

export const DropboxBlockMeta = {
  tags: ['cloud', 'document-processing'],
  url: 'https://www.dropbox.com',
  templates: [
    {
      icon: DropboxIcon,
      title: 'Dropbox to knowledge base',
      prompt:
        'Build a scheduled workflow that lists a Dropbox folder, downloads documents added since the last run, extracts and chunks their text, and upserts the chunks into a knowledge base for agent retrieval.',
      modules: ['scheduled', 'knowledge-base', 'files', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'sync'],
    },
    {
      icon: DropboxIcon,
      title: 'Dropbox shared-link auditor',
      prompt:
        'Create a scheduled workflow that lists Dropbox shared links, identifies links shared with external users or marked public, and writes a security review report to a table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
    {
      icon: DropboxIcon,
      title: 'Dropbox vendor-invoice intake',
      prompt:
        'Build a scheduled workflow that lists a Dropbox vendor folder for invoice PDFs added since the last run, extracts vendor and amount with an agent, writes the row to a payables table, and pings finance on Slack.',
      modules: ['scheduled', 'files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DropboxIcon,
      title: 'Dropbox creative asset organizer',
      prompt:
        'Create a scheduled workflow that lists a Dropbox creative-assets folder, classifies files added since the last run by campaign and type, moves them into the right subfolder, and updates a tables-based asset index.',
      modules: ['scheduled', 'files', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content'],
    },
    {
      icon: DropboxIcon,
      title: 'Dropbox retention sweeper',
      prompt:
        'Build a scheduled workflow that finds Dropbox files older than the retention policy, archives them to long-term storage, and writes the cleanup record to an audit table.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
    {
      icon: DropboxIcon,
      title: 'Dropbox to Notion publisher',
      prompt:
        'Create a scheduled workflow that lists Dropbox markdown files added since the last run, converts each to a Notion page in the right database, and writes a link back to the source file metadata.',
      modules: ['scheduled', 'files', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['content', 'sync'],
      alsoIntegrations: ['notion'],
    },
    {
      icon: DropboxIcon,
      title: 'Dropbox + DocuSign signed-doc archiver',
      prompt:
        'Build a scheduled workflow that polls DocuSign for completed envelopes, downloads each signed PDF, saves it to a Dropbox compliance folder, and writes the audit record to a contracts table.',
      modules: ['scheduled', 'files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'sync'],
      alsoIntegrations: ['docusign'],
    },
  ],
  skills: [
    {
      name: 'upload-file-to-dropbox',
      description:
        'Upload a file to a specific Dropbox path and optionally generate a shareable link.',
      content:
        '# Upload File to Dropbox\n\nSave a file into Dropbox at a chosen location and optionally share it.\n\n## Steps\n1. Determine the destination path, including the filename and extension (e.g., /reports/q3-summary.pdf).\n2. Call Upload File with the file and destination path. Use overwrite mode only if replacing an existing file; otherwise use add and enable auto-rename to avoid clobbering.\n3. If a shareable link is requested, call Create Shared Link on the uploaded path with the requested visibility (public, team-only, or password-protected).\n\n## Output\nReport the final stored path (after any auto-rename) and, if created, the shared link URL.',
    },
    {
      name: 'find-files-in-dropbox',
      description:
        'Search Dropbox for files by query, extension, or folder, and return matching paths.',
      content:
        '# Find Files in Dropbox\n\nLocate files in Dropbox matching a search term or filter.\n\n## Steps\n1. Use Search Files with the query term. Scope to a folder path when the location is known, and pass file extensions (e.g., pdf,xlsx) to narrow results.\n2. If browsing a known folder instead of searching, use List Folder with the folder path; enable recursive listing to include subfolders.\n3. For any candidate match, use Get Metadata to confirm size, type, and last-modified time before acting on it.\n\n## Output\nReturn the matching files as a list of path, name, size, and last-modified. If nothing matches, say so and suggest a broader query.',
    },
    {
      name: 'organize-dropbox-folder',
      description: 'List a folder and move, copy, or delete files to reorganize Dropbox contents.',
      content:
        '# Organize Dropbox Folder\n\nReorganize files in Dropbox by moving them into the right folders.\n\n## Steps\n1. Call List Folder on the source path to enumerate the files to process.\n2. Decide each file destination based on the requested rules (by type, date, campaign, or naming pattern). Create target folders with Create Folder if they do not exist.\n3. Use Move File/Folder to relocate each file, or Copy File/Folder when the original must stay in place. Enable auto-rename to avoid conflicts.\n\n## Output\nReturn a summary of every file moved or copied with its old and new path, and flag any operation that failed.',
    },
    {
      name: 'share-dropbox-link',
      description:
        'Create a shared link for a Dropbox file or folder with controlled visibility and expiration.',
      content:
        '# Share Dropbox Link\n\nGenerate a shareable link for an existing Dropbox item with the right access controls.\n\n## Steps\n1. Confirm the exact path of the file or folder. Use Get Metadata to verify it exists.\n2. Call Create Shared Link with the path and the requested visibility — public for anyone, team-only for internal sharing, or password-protected with a supplied password.\n3. Set an expiration date if the link should not be permanent.\n\n## Output\nReturn the shared link URL, its visibility setting, and the expiration date if one was applied.',
    },
  ],
} as const satisfies BlockMeta
