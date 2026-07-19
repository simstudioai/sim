import { buildLandingMetadata } from '@/lib/landing/seo'
import ItSolution, { IT_PAGE_DESCRIPTION } from '@/app/(landing)/solutions/it/it'

export const revalidate = 3600

const TITLE = 'AI Agents for IT: Ticket Triage & Access Provisioning | Sim'

export const metadata = buildLandingMetadata({
  title: TITLE,
  description: IT_PAGE_DESCRIPTION,
  path: '/solutions/it',
  keywords:
    'AI workspace, IT automation, AI agents for IT, IT service desk automation, access provisioning, infrastructure monitoring, open-source AI agent platform',
  twitterImageAlt: 'Sim',
})

export default function Page() {
  return <ItSolution />
}
