import type { Metadata } from 'next'
import { SITE_URL } from '@/lib/core/utils/urls'
import Terms from '@/app/(landing)/terms/terms'

export const revalidate = 3600

const PAGE_URL = `${SITE_URL}/terms`
const TITLE = 'Terms of Service | Sim, the AI Workspace'
const DESCRIPTION =
  'The terms and conditions for using Sim, the open-source AI workspace: subscription plans, data ownership, acceptable use, and your rights.'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { absolute: TITLE },
  description: DESCRIPTION,
  authors: [{ name: 'Sim' }],
  creator: 'Sim',
  publisher: 'Sim',
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: 'website',
    url: PAGE_URL,
    siteName: 'Sim',
    locale: 'en_US',
    images: [
      {
        url: '/logo/426-240/reverse/small.png',
        width: 2130,
        height: 1200,
        alt: 'Terms of Service | Sim, the AI Workspace',
        type: 'image/png',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@simdotai',
    creator: '@simdotai',
    title: TITLE,
    description: DESCRIPTION,
    images: {
      url: '/logo/426-240/reverse/small.png',
      alt: 'Terms of Service | Sim, the AI Workspace',
    },
  },
  alternates: {
    canonical: PAGE_URL,
    languages: { 'en-US': PAGE_URL, 'x-default': PAGE_URL },
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
  },
  category: 'technology',
}

export default function Page() {
  return <Terms />
}
