'use client'

import { CredentialsManager } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/settings-modal/components/credentials/credentials-manager'

interface CredentialsProps {
  onOpenChange?: (open: boolean) => void
}

export function Credentials(_props: CredentialsProps) {
  return (
    <div className='h-full min-h-0'>
      <CredentialsManager />
    </div>
  )
}
