import { buildLandingMetadata } from '@/lib/landing/seo'
import SalesSolution from '@/app/(landing)/solutions/sales/sales'

export const revalidate = 3600

const TITLE = 'AI Agents for Lead Research & CRM Updates | Sim'
const DESCRIPTION =
  'Sales teams use Sim, the open-source AI workspace, to build and deploy AI agents that automate lead research, personalized outreach, and CRM updates.'

export const metadata = buildLandingMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: '/solutions/sales',
  keywords:
    'AI workspace, AI agents for sales, sales automation, lead research, CRM automation, pipeline reporting, open-source AI agent platform',
  twitterImageAlt: 'Sim',
})

export default function Page() {
  return <SalesSolution />
}
