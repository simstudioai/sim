import { buildLandingMetadata } from '@/lib/landing/seo'
import HrSolution, { HR_PAGE_DESCRIPTION } from '@/app/(landing)/solutions/hr/hr'

export const revalidate = 3600

const TITLE = 'AI Agents for HR: Onboarding & Employee Operations | Sim'

export const metadata = buildLandingMetadata({
  title: TITLE,
  description: HR_PAGE_DESCRIPTION,
  path: '/solutions/hr',
  keywords:
    'AI workspace, AI agents for HR, HR automation, employee onboarding, people operations, HRIS automation, open-source AI agent platform',
  twitterImageAlt: 'Sim',
})

export default function Page() {
  return <HrSolution />
}
