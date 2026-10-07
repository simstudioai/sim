import { StatusPageContent } from '@sim/emcn'
import type { Metadata } from 'next'
import { LogoShell } from '@/components/logo-shell'
import { ReturnHomeLink } from '@/components/status-page/return-home-link'

export const metadata: Metadata = {
  title: 'Page Not Found',
  robots: { index: false, follow: true },
}

export default function NotFound() {
  return (
    <LogoShell center theme='inherit'>
      <StatusPageContent
        title='Page not found'
        description="The page you're looking for doesn't exist or has been moved."
      >
        <ReturnHomeLink />
      </StatusPageContent>
    </LogoShell>
  )
}
