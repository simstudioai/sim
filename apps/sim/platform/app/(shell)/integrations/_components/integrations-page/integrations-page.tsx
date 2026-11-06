import type { ComponentProps, ReactNode } from 'react'
import {
  DirectoryBack,
  DirectoryHeading,
  DirectoryPage,
} from '@/platform/app/(shell)/_components/resource-directory/resource-directory'

interface IntegrationsPageProps {
  /** A detail page's way back. The index has none. */
  back?: ComponentProps<typeof DirectoryBack>
  children: ReactNode
}

export function IntegrationsPage({ back, children }: IntegrationsPageProps) {
  return (
    <DirectoryPage>
      {back && <DirectoryBack {...back} />}
      {children}
    </DirectoryPage>
  )
}

interface IntegrationsHeadingProps {
  /** Actions for a flow the member arrived through, such as returning to Slack. */
  handoff?: ReactNode
}

export function IntegrationsHeading({ handoff }: IntegrationsHeadingProps) {
  return (
    <DirectoryHeading
      title='Integrations'
      description='Connect your tools, share with your team, and bring everything into Sim.'
    >
      {handoff}
    </DirectoryHeading>
  )
}
