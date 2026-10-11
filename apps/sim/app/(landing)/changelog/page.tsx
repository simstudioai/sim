import { CHANGELOG_SECTION } from '@/lib/changelog'
import { buildLandingMetadata } from '@/lib/landing/seo'
import Changelog from '@/app/(landing)/changelog/changelog'

export const revalidate = 3600

export const metadata = buildLandingMetadata({
  title: 'Changelog | Sim, the AI Workspace',
  description: CHANGELOG_SECTION.description,
  path: '/changelog',
})

export default function Page() {
  return <Changelog />
}
