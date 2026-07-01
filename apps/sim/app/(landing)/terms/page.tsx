import { buildLandingMetadata } from '@/lib/landing/seo'
import Terms from '@/app/(landing)/terms/terms'

export const revalidate = 3600

const TITLE = 'Terms of Service | Sim, the AI Workspace'
const DESCRIPTION =
  'The terms and conditions for using Sim, the open-source AI workspace: subscription plans, data ownership, acceptable use, and your rights.'

export const metadata = buildLandingMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: '/terms',
})

export default function Page() {
  return <Terms />
}
