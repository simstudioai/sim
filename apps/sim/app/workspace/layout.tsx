import type { Metadata, Viewport } from 'next'
import { SITE_VIEWPORT, SiteRootLayout } from '@/app/_shell/site-root-layout'
import { WorkspaceRoot } from '@/app/workspace/workspace-root'
import { generateBrandedMetadata } from '@/ee/whitelabeling'

export const viewport: Viewport = SITE_VIEWPORT

export const metadata: Metadata = generateBrandedMetadata()

interface WorkspaceRootLayoutProps {
  children: React.ReactNode
}

export default function WorkspaceRootLayout({ children }: WorkspaceRootLayoutProps) {
  return (
    <SiteRootLayout>
      <WorkspaceRoot>{children}</WorkspaceRoot>
    </SiteRootLayout>
  )
}
