import { buildLandingMetadata } from '@/lib/landing/seo'
import HrSolution from '@/app/(landing)/solutions/hr/hr'

export const revalidate = 3600

const TITLE = 'AI Agents for Onboarding & People Operations | Sim'
const DESCRIPTION =
  'HR teams use Sim, the open-source AI workspace, to build and deploy AI agents that automate onboarding, employee questions, and approvals.'

export const metadata = buildLandingMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: '/solutions/hr',
  keywords:
    'AI workspace, AI agents for HR, HR automation, employee onboarding, people operations, HRIS automation, open-source AI agent platform',
  twitterImageAlt: 'Sim',
})

export default function Page() {
  return <HrSolution />
}
