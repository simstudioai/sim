import { buildLandingMetadata } from '@/lib/landing/seo'
import SalesSolution, { SALES_PAGE_DESCRIPTION } from '@/app/(landing)/solutions/sales/sales'

export const revalidate = 3600

const TITLE = 'AI Agents for Sales: Lead Research & CRM Updates | Sim'

export const metadata = buildLandingMetadata({
  title: TITLE,
  description: SALES_PAGE_DESCRIPTION,
  path: '/solutions/sales',
  keywords:
    'AI workspace, AI agents for sales, sales automation, lead research, CRM automation, pipeline reporting, open-source AI agent platform',
  twitterImageAlt: 'Sim',
})

export default function Page() {
  return <SalesSolution />
}
