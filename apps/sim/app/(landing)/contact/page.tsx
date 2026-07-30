import { buildLandingMetadata } from '@/lib/landing/seo'
import Contact from '@/app/(landing)/contact/contact'

export const revalidate = 3600

const TITLE = 'Contact Us | Sim, the AI Workspace'
const DESCRIPTION =
  'Get in touch with Sim, the open-source AI workspace where teams build, deploy, and manage AI agents. Ask a question, request an integration, or get help from the team.'

export const metadata = buildLandingMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: '/contact',
})

export default function Page() {
  return <Contact />
}
