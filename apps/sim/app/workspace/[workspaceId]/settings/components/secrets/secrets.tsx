import { SecretsManager } from '@/app/workspace/[workspaceId]/settings/components/secrets/secrets-manager'

export function Secrets() {
  return (
    <div className='h-full min-h-0'>
      <SecretsManager />
    </div>
  )
}
