import type { Metadata, Viewport } from 'next'
import { SITE_VIEWPORT, SiteRootLayout } from '@/app/_shell/site-root-layout'
import { generateBrandedMetadata } from '@/ee/whitelabeling'

export const viewport: Viewport = SITE_VIEWPORT

export const metadata: Metadata = generateBrandedMetadata()

interface SiteLayoutProps {
  children: React.ReactNode
}

/** Root layout for the standalone app routes (account, invite, desktop and OAuth handoffs, and so on). */
export default function SiteLayout({ children }: SiteLayoutProps) {
  return <SiteRootLayout>{children}</SiteRootLayout>
}
