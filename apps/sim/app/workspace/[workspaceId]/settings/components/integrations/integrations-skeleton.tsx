import { Skeleton } from '@/components/emcn'
import { CredentialSkeleton } from '@/app/workspace/[workspaceId]/settings/components/credentials/credential-skeleton'

/**
 * Skeleton for the Integrations section shown during dynamic import loading.
 */
export function IntegrationsSkeleton() {
  return (
    <div className='flex h-full flex-col gap-4.5'>
      <div className='flex items-center gap-2'>
        <Skeleton className='h-[30px] flex-1 rounded-lg' />
        <Skeleton className='h-[30px] w-[100px] rounded-md' />
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <div className='flex flex-col gap-2'>
          <CredentialSkeleton />
          <CredentialSkeleton />
          <CredentialSkeleton />
        </div>
      </div>
    </div>
  )
}
