import { chipContentLabelClass, chipVariants, cn } from '@sim/emcn'
import type { Metadata } from 'next'
import { StatusPageContent } from '@/components/status-page'
import { LogoShell } from '@/app/(landing)/components'

export const metadata: Metadata = {
  title: 'Page Not Found',
  robots: { index: false, follow: true },
}

export default function NotFound() {
  return (
    <LogoShell center>
      <StatusPageContent
        title='Page not found'
        description="The page you're looking for doesn't exist or has been moved."
      >
        <a href='/' className={chipVariants({ variant: 'primary' })}>
          <span className={cn(chipContentLabelClass, 'flex-1 text-current')}>Return home</span>
        </a>
      </StatusPageContent>
    </LogoShell>
  )
}
