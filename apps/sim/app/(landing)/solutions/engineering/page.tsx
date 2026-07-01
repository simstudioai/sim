import { buildLandingMetadata } from '@/lib/landing/seo'
import EngineeringSolution from '@/app/(landing)/solutions/engineering/engineering'

export const revalidate = 3600

const TITLE = 'AI Agents for Code Review & On-Call | Sim'
const DESCRIPTION =
  'Engineering teams use Sim, the open-source AI workspace, to build and deploy AI agents that automate code review, on-call triage, and documentation.'

export const metadata = buildLandingMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: '/solutions/engineering',
  keywords:
    'AI workspace, AI agents for engineering, automated code review, on-call automation, CI/CD agents, developer automation, open-source AI agent platform',
  twitterImageAlt: 'Sim',
})

export default function Page() {
  return <EngineeringSolution />
}
