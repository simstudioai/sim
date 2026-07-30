import { buildLandingMetadata } from '@/lib/landing/seo'
import Changelog from '@/app/(landing)/changelog/changelog'

export const revalidate = 3600

const TITLE = 'Changelog | Sim, the AI Workspace'
const DESCRIPTION =
  'Every new feature, improvement, and fix in Sim, the open-source AI workspace, with release notes straight from GitHub.'

export const metadata = buildLandingMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: '/changelog',
})

export default function Page() {
  return <Changelog />
}
