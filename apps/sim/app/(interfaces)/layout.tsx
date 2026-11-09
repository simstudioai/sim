import type { ReactNode } from 'react'
import type { Metadata, Viewport } from 'next'
import { SITE_VIEWPORT, SiteRootLayout } from '@/app/_shell/site-root-layout'
import { generateBrandedMetadata } from '@/ee/whitelabeling'

export const viewport: Viewport = SITE_VIEWPORT

export const metadata: Metadata = generateBrandedMetadata()

interface InterfacesLayoutProps {
  children: ReactNode
}
export default function InterfacesLayout({ children }: InterfacesLayoutProps) {
  return <SiteRootLayout>{children}</SiteRootLayout>
}
