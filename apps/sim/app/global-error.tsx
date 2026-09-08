'use client'

import { Chip } from '@sim/emcn'
import { StatusPageContent } from '@/components/status-page'
import { season } from '@/app/_styles/fonts/season/season'
import { LogoShell } from '@/app/(landing)/components/logo-shell'
import '@/app/_styles/globals.css'

interface GlobalErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function GlobalError({ reset }: GlobalErrorProps) {
  return (
    <html lang='en' className='light'>
      <body className={`${season.variable} font-season`}>
        <LogoShell center>
          <StatusPageContent
            title='Something went wrong'
            description='An unexpected error occurred. Please try again.'
          >
            <Chip variant='primary' onClick={reset}>
              Try again
            </Chip>
          </StatusPageContent>
        </LogoShell>
      </body>
    </html>
  )
}
