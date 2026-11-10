'use client'

import type { ReactNode } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { PlatformSurface } from '@sim/emcn-platform/surface/platform-surface'
import { useRouter } from 'next/navigation'
import styles from '@/app/(product)/_components/shell-gate/shell-gate.module.css'

interface ShellGateProps {
  title: string
  description: string
  /** Outside the shell, which is what would otherwise supply the theme and fill the window. */
  fullPage?: boolean
  children: ReactNode
}

/** A centered message with its actions, inside the shell or, with `fullPage`, in place of it. */
export function ShellGate({ title, description, fullPage, children }: ShellGateProps) {
  const gate = (
    <main className={styles.gate} data-full-page={fullPage || undefined}>
      <EmptyState
        title={title}
        description={description}
        action={<div className={styles.actions}>{children}</div>}
      />
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
  /** Next's error-boundary `retry`: refetches the failed server segment, then re-renders it. */
  retry: () => void
  fullPage?: boolean
}

export function PageError({ retry, fullPage }: PageErrorProps) {
  return (
    <ShellGate
      fullPage={fullPage}
      title='Something went wrong'
      description='An unexpected error occurred. Please try again or refresh the page.'
    >
      <Button variant='primary' onClick={retry}>
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

/**
 * A workspace page that does not exist, or a workspace the viewer cannot open: the workspace layout
 * does not tell the two apart, so neither reveals whether the workspace exists.
 */
export function WorkspacePageNotFound() {
  const router = useRouter()
  return (
    <ShellGate
      title='Page not found'
      description="This page doesn't exist, has been moved, or is in a workspace you don't have access to. Ask a workspace administrator for access or choose another workspace."
    >
      <Button onClick={() => router.back()}>Go back</Button>
      <Button variant='primary' onClick={() => router.push('/')}>
        Return home
      </Button>
    </ShellGate>
  )
}
