import { buildLandingMetadata } from '@/lib/landing/seo'
import FinanceSolution, {
  FINANCE_PAGE_DESCRIPTION,
} from '@/app/(landing)/solutions/finance/finance'

export const revalidate = 3600

const TITLE = 'AI Agents for Finance: Invoicing & Reconciliation | Sim'

export const metadata = buildLandingMetadata({
  title: TITLE,
  description: FINANCE_PAGE_DESCRIPTION,
  path: '/solutions/finance',
  keywords:
    'AI workspace, AI agents for finance, finance automation, invoice processing, account reconciliation, financial reporting, open-source AI agent platform',
  twitterImageAlt: 'Sim',
})

export default function Page() {
  return <FinanceSolution />
}
