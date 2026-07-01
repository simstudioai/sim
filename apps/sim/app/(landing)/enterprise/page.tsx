import { buildLandingMetadata } from '@/lib/landing/seo'
import EnterprisePage from '@/app/(landing)/enterprise/enterprise'

export const revalidate = 3600

const TITLE = 'Enterprise AI Agent Platform | Sim AI'
const DESCRIPTION =
  'Build, deploy, and govern enterprise AI agents in one workspace with security, approvals, observability, and collaboration.'

export const metadata = buildLandingMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: '/enterprise',
  keywords:
    'enterprise ai agents, enterprise ai agent, enterprise ai agent platform, enterprise workflow agents',
  twitterImageAlt: 'Sim',
})

export default function Page() {
  return <EnterprisePage />
}
