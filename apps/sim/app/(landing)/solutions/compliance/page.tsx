import { buildLandingMetadata } from '@/lib/landing/seo'
import ComplianceSolution from '@/app/(landing)/solutions/compliance/compliance'

export const revalidate = 3600

const TITLE = 'AI Agents for Continuous Compliance & Audit | Sim'
const DESCRIPTION =
  'Compliance teams use Sim, the open-source AI workspace, to build and deploy AI agents that automate evidence collection, control monitoring, and reporting.'

export const metadata = buildLandingMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: '/solutions/compliance',
  keywords:
    'AI workspace, AI agents for compliance, compliance automation, evidence collection, control monitoring, audit readiness, open-source AI agent platform',
  twitterImageAlt: 'Sim',
})

export default function Page() {
  return <ComplianceSolution />
}
