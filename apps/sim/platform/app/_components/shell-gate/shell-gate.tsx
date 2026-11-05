'use client'

import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import styles from '@/platform/app/_components/shell-gate/shell-gate.module.css'
import { Button, EmptyState, PlatformSurface } from '@/platform/design-system/components'

interface ShellGateProps {
  title: string
  description: string
  /** Outside the shell, which is what would otherwise supply the theme and fill the window. */
  fullPage?: boolean
  children: ReactNode
}

function ShellGate({ title, description, fullPage, children }: ShellGateProps) {
  const gate = (
    <main className={styles.gate} data-full-page={fullPage || undefined}>
      <EmptyState title={title} description={description} action={children} />
    </main>
  )
  return fullPage ? <PlatformSurface theme='system'>{gate}</PlatformSurface> : gate
}

interface AccessDeniedProps {
  workspacesHref: string
}

export function AccessDenied({ workspacesHref }: AccessDeniedProps) {
  return (
    <ShellGate
      fullPage
      title='Organization access denied'
      description='You are not a member of this organization. Ask an organization admin to add you, or head back to your workspaces.'
    >
      <Button variant='primary' onClick={() => window.location.assign(workspacesHref)}>
        View your workspaces
      </Button>
    </ShellGate>
  )
}

/** The organization could not be read. Never an empty organization, and retrying re-reads it. */
export function SurfaceUnavailable() {
  const router = useRouter()
  return (
    <ShellGate
      fullPage
      title='Something went wrong'
      description='Sim could not load your organization. Please try again.'
    >
      <Button variant='primary' onClick={() => router.refresh()}>
        Try again
      </Button>
    </ShellGate>
  )
}

interface PageErrorProps {
  reset: () => void
  fullPage?: boolean
}

export function PageError({ reset, fullPage }: PageErrorProps) {
  return (
    <ShellGate
      fullPage={fullPage}
      title='Something went wrong'
      description='An unexpected error occurred. Please try again or refresh the page.'
    >
      <Button variant='primary' onClick={reset}>
        Try again
      </Button>
    </ShellGate>
  )
}

interface PageNotFoundProps {
  fullPage?: boolean
}

export function PageNotFound({ fullPage }: PageNotFoundProps) {
  const router = useRouter()
  return (
    <ShellGate
      fullPage={fullPage}
      title='Page not found'
      description="The page you're looking for doesn't exist or has been moved."
    >
      <Button onClick={() => router.back()}>Go back</Button>
      <Button variant='primary' onClick={() => router.push('/')}>
        Return home
      </Button>
    </ShellGate>
  )
}
