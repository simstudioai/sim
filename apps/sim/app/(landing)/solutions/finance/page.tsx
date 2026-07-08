import { buildLandingMetadata } from '@/lib/landing/seo'
import FinanceSolution from '@/app/(landing)/solutions/finance/finance'

export const revalidate = 3600

const TITLE = 'AI Agents for Invoice Processing & Reconciliation | Sim'
const DESCRIPTION =
  'Finance teams use Sim, the open-source AI workspace, to build and deploy AI agents that automate reconciliation, invoice processing, and reporting.'

export const metadata = buildLandingMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: '/solutions/finance',
  keywords:
    'AI workspace, AI agents for finance, finance automation, invoice processing, account reconciliation, financial reporting, open-source AI agent platform',
  twitterImageAlt: 'Sim',
})

export default function Page() {
  return <FinanceSolution />
}
