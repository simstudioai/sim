import { buildLandingMetadata } from '@/lib/landing/seo'
import Files from '@/app/(landing)/files/files'

export const revalidate = 3600

const TITLE = 'Files | One File Store for Teams and Agents in Sim, the AI Workspace'
const DESCRIPTION =
  'Files is the file store in Sim, the open-source AI workspace. Upload, create, and share files in one place — agents read them as inputs and produce them as outputs.'

export const metadata = buildLandingMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: '/files',
  keywords:
    'AI workspace, file store for AI agents, shared file storage, AI agents read files, agents generate files, document parsing agents, AI file management, open-source AI workspace',
})

export default function Page() {
  return <Files />
}
