import { buildLandingMetadata } from '@/lib/landing/seo'
import CookiePolicy from '@/app/(landing)/cookie-policy/cookie-policy'

export const revalidate = 3600

const TITLE = 'Cookie Policy | Sim, the AI Workspace'
const DESCRIPTION =
  'What cookies Sim sets, why, how long they last, and how to change your choice at any time.'

export const metadata = buildLandingMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: '/cookie-policy',
})

export default function Page() {
  return <CookiePolicy />
}
