import { buildLandingMetadata } from '@/lib/landing/seo'
import ComplianceSolution, {
  COMPLIANCE_PAGE_DESCRIPTION,
} from '@/app/(landing)/solutions/compliance/compliance'

export const revalidate = 3600

const TITLE = 'AI Agents for Compliance: Evidence & Audit Reports | Sim'

export const metadata = buildLandingMetadata({
  title: TITLE,
  description: COMPLIANCE_PAGE_DESCRIPTION,
  path: '/solutions/compliance',
  keywords:
    'AI workspace, AI agents for compliance, compliance automation, evidence collection, control monitoring, audit readiness, open-source AI agent platform',
  twitterImageAlt: 'Sim',
})

export default function Page() {
  return <ComplianceSolution />
}
