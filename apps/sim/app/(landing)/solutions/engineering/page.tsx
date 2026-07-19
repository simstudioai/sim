import { buildLandingMetadata } from '@/lib/landing/seo'
import EngineeringSolution, {
  ENGINEERING_PAGE_DESCRIPTION,
} from '@/app/(landing)/solutions/engineering/engineering'

export const revalidate = 3600

const TITLE = 'AI Agents for Engineering: Code Review & On-Call | Sim'

export const metadata = buildLandingMetadata({
  title: TITLE,
  description: ENGINEERING_PAGE_DESCRIPTION,
  path: '/solutions/engineering',
  keywords:
    'AI workspace, AI agents for engineering, automated code review, on-call automation, CI/CD agents, developer automation, open-source AI agent platform',
  twitterImageAlt: 'Sim',
})

export default function Page() {
  return <EngineeringSolution />
}
