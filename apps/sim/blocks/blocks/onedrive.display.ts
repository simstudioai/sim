import { MicrosoftOneDriveIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const OneDriveBlockDisplay = {
  type: 'onedrive',
  name: 'OneDrive',
  description: 'Create, upload, download, list, and delete files',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: MicrosoftOneDriveIcon,
  longDescription:
    'Integrate OneDrive into the workflow. Can create text and Excel files, upload files, download files, list files, and delete files or folders.',
  docsLink: 'https://docs.sim.ai/integrations/onedrive',
  integrationType: IntegrationType.Documents,
} satisfies BlockDisplay

export const OneDriveBlockMeta = {
  tags: ['microsoft-365', 'cloud', 'document-processing'],
  url: 'https://www.microsoft.com/microsoft-365/onedrive',
  templates: [
    {
      icon: MicrosoftOneDriveIcon,
      title: 'OneDrive contract intake',
      prompt:
        'Create a scheduled workflow that polls a OneDrive intake folder for new contract PDFs, extracts clauses with Reducto, writes the structured terms to a table, and pings legal in Teams.',
      modules: ['scheduled', 'files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'automation'],
      alsoIntegrations: ['reducto', 'microsoft_teams'],
    },
    {
      icon: MicrosoftOneDriveIcon,
      title: 'OneDrive sharing audit',
      prompt:
        'Build a scheduled weekly workflow that lists OneDrive files shared externally, flags ones above a sensitivity score, and writes a security review report.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
    {
      icon: MicrosoftOneDriveIcon,
      title: 'OneDrive to knowledge base sync',
      prompt:
        'Create a workflow that mirrors OneDrive folders into a knowledge base, chunks and embeds new content on change, and removes deleted files so retrieval stays accurate.',
      modules: ['knowledge-base', 'files', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'sync'],
    },
    {
      icon: MicrosoftOneDriveIcon,
      title: 'OneDrive backup verifier',
      prompt:
        'Build a scheduled workflow that verifies OneDrive backups by sampling files and comparing checksums against the originating SharePoint copy, writing the report to an SRE table.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'enterprise'],
      alsoIntegrations: ['sharepoint'],
    },
    {
      icon: MicrosoftOneDriveIcon,
      title: 'OneDrive retention cleaner',
      prompt:
        'Create a scheduled workflow that finds OneDrive files older than the retention horizon, requires manager approval through Teams, and archives or deletes per the policy.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
      alsoIntegrations: ['microsoft_teams'],
    },
    {
      icon: MicrosoftOneDriveIcon,
      title: 'OneDrive Excel-pipeline opener',
      prompt:
        'Build a scheduled workflow that polls OneDrive for new Excel data drops, normalizes each, writes to a downstream table, and emails the analyst that the latest file is ready.',
      modules: ['scheduled', 'files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['analysis', 'sync'],
      alsoIntegrations: ['microsoft_excel', 'gmail'],
    },
    {
      icon: MicrosoftOneDriveIcon,
      title: 'OneDrive new-hire kit deployer',
      prompt:
        'Create a workflow triggered by a Workday new hire that creates a OneDrive new-hire folder, uploads the standard onboarding documents into it, and writes the folder link into the onboarding tracker.',
      modules: ['files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'automation'],
      alsoIntegrations: ['workday'],
    },
  ],
  skills: [
    {
      name: 'upload-file-to-folder',
      description: 'Upload a file to a specific OneDrive folder, creating the folder if needed.',
      content:
        '# Upload File to Folder\n\nPlace a file into the right OneDrive folder.\n\n## Steps\n1. Use List Files to confirm the destination folder exists; if not, run Create Folder.\n2. Run Upload File with the file content and the target folder.\n3. Use a clear, consistent filename so the document is easy to find later.\n\n## Output\nConfirm the uploaded file name, its folder, and the file id or link.',
    },
    {
      name: 'find-and-download-file',
      description: 'Locate a file in OneDrive by name and download its contents.',
      content:
        '# Find and Download File\n\nRetrieve a file from OneDrive for processing.\n\n## Steps\n1. Run List Files in the likely folder to find the file and its id.\n2. Run Download File with the matched file id.\n3. Pass the downloaded content to the next step, such as a parser or summarizer.\n\n## Output\nConfirm the file downloaded with its name and size, and hand off the content.',
    },
    {
      name: 'save-generated-document',
      description:
        'Create a new text or document file in OneDrive from generated content, in the right folder.',
      content:
        '# Save Generated Document\n\nWrite generated content, such as a report or notes, into OneDrive as a new file.\n\n## Steps\n1. Use List Files to confirm the destination folder exists; if not, run Create Folder.\n2. Compose the document content and choose a clear filename and type.\n3. Run Create File with the content, filename, and target folder.\n\n## Output\nConfirm the created file name, its folder, and the file id or link.',
    },
  ],
} as const satisfies BlockMeta
