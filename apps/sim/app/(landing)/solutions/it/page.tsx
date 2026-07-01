import { buildLandingMetadata } from '@/lib/landing/seo'
import ItSolution from '@/app/(landing)/solutions/it/it'

export const revalidate = 3600

const TITLE = 'AI Agents for Ticket Triage & Access | Sim'
const DESCRIPTION =
  'IT teams use Sim, the open-source AI workspace, to build and deploy AI agents that automate ticket triage, access provisioning, and monitoring.'

export const metadata = buildLandingMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: '/solutions/it',
  keywords:
    'AI workspace, IT automation, AI agents for IT, IT service desk automation, access provisioning, infrastructure monitoring, open-source AI agent platform',
  twitterImageAlt: 'Sim',
})

export default function Page() {
  return <ItSolution />
}
