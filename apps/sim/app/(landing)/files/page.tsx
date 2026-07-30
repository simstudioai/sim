import { buildLandingMetadata } from '@/lib/landing/seo'
import Files, { FILES_PAGE_DESCRIPTION } from '@/app/(landing)/files/files'

export const revalidate = 3600

const TITLE = 'File Storage for AI Agents and Your Team | Sim'

export const metadata = buildLandingMetadata({
  title: TITLE,
  description: FILES_PAGE_DESCRIPTION,
  path: '/files',
  keywords:
    'AI workspace, file store for AI agents, shared file storage, AI agents read files, agents generate files, document parsing agents, AI file management, open-source AI workspace',
})

export default function Page() {
  return <Files />
}
