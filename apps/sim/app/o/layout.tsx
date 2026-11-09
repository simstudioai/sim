import type { Metadata, Viewport } from 'next'
import { SITE_VIEWPORT, SiteRootLayout } from '@/app/_shell/site-root-layout'
import { generateBrandedMetadata } from '@/ee/whitelabeling'

export const viewport: Viewport = SITE_VIEWPORT

export const metadata: Metadata = generateBrandedMetadata()

interface OrganizationRootLayoutProps {
  children: React.ReactNode
}

export default function OrganizationRootLayout({ children }: OrganizationRootLayoutProps) {
  return <SiteRootLayout>{children}</SiteRootLayout>
}
