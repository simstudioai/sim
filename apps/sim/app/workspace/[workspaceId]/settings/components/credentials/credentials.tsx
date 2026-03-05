'use client'

import { CredentialsManager } from '@/app/workspace/[workspaceId]/settings/components/credentials/credentials-manager'

export function Credentials() {
  return (
    <div className='h-full min-h-0'>
      <CredentialsManager />
    </div>
  )
}
