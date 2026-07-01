import { buildLandingMetadata } from '@/lib/landing/seo'
import Privacy from '@/app/(landing)/privacy/privacy'

export const revalidate = 3600

const TITLE = 'Privacy Policy | Sim, the AI Workspace'
const DESCRIPTION =
  'How Sim, the open-source AI workspace, collects, uses, and protects your data, including data obtained from Google APIs, and the controls you have over it.'

export const metadata = buildLandingMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: '/privacy',
})

export default function Page() {
  return <Privacy />
}
