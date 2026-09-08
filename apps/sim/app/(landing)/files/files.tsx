import {
  SolutionsPage,
  type SolutionsProductPageConfig,
} from '@/app/(landing)/components/solutions-page'
import { ProductHeroPreview } from '@/app/(landing)/components/solutions-page/components/solutions-product-page/components/product-hero-preview'
import { FilesDocumentPreview } from '@/app/(landing)/files/components/files-document-preview'
import { FilesLibraryPreview } from '@/app/(landing)/files/components/files-library-preview'
import { FilesWorkflowPreview } from '@/app/(landing)/files/components/files-workflow-preview'

/** Shared description for page metadata and structured data. */
export const FILES_PAGE_DESCRIPTION =
  'Keep team uploads and agent outputs together in Sim Files. Organize folders, preview documents, edit markdown, and read or write files from workflows.'

const FILES_CONFIG: SolutionsProductPageConfig = {
  module: 'Files',
  path: '/files',
  seoDescription: FILES_PAGE_DESCRIPTION,
  hero: {
    eyebrow: 'Files',
    heading: 'One home for your agents’ files.',
    description: 'Keep your team’s documents and your agents’ outputs together in Sim.',
    summary:
      'Sim Files is shared file storage in the open-source AI workspace where teams build, deploy, and manage AI agents. Organize uploads in folders, preview documents, edit markdown, and use the File block to read content, pass attachments, and save outputs from agent runs.',
    visual: <ProductHeroPreview product='files' />,
  },
  codeExample: {
    title: 'Read and write from your terminal.',
    description:
      'List workspace files, download inputs, and upload finished reports with the Sim CLI.',
    filename: 'files.sh',
    commands: ['sim files list', 'sim files get "$FILE_ID"', 'sim files upload ./report.pdf'],
  },
  features: [
    {
      id: 'organize',
      label: 'A shared library',
      title: 'Everything, in its place.',
      description:
        'Organize folders, find the right source, and preview a file without leaving your workspace.',
      visual: <FilesLibraryPreview />,
      cta: { label: 'Explore Files', href: 'https://docs.sim.ai/files' },
    },
    {
      id: 'review',
      label: 'Documents in context',
      title: 'Open the file. Keep working.',
      description: 'Preview documents and edit markdown alongside the rest of your team’s work.',
      visual: <FilesDocumentPreview />,
      cta: { label: 'Explore the editor', href: 'https://docs.sim.ai/files/editor' },
    },
    {
      id: 'workflows',
      label: 'Inputs and outputs',
      title: 'Inputs in. Finished work out.',
      description: 'Read a file, let an agent work with it, and save the result back to Sim.',
      visual: <FilesWorkflowPreview />,
      cta: {
        label: 'See Files in workflows',
        href: 'https://docs.sim.ai/files/using-in-workflows',
      },
    },
  ],
}

export default function Files() {
  return <SolutionsPage config={FILES_CONFIG} />
}
