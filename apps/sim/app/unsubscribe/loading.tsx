import { AuthSkeleton } from '@sim/emcn-auth/loading'
import { AuthStack } from '@sim/emcn-auth/stack'
import { InviteLayout } from '@/app/invite/components'

export default function UnsubscribeLoading() {
  return (
    <InviteLayout>
      <AuthStack>
        <div className='au:flex au:flex-col au:gap-1'>
          <AuthSkeleton shape='title' className='au:w-[180px]' />
          <AuthSkeleton shape='label' className='au:w-[300px]' />
        </div>
        <AuthSkeleton />
      </AuthStack>
    </InviteLayout>
  )
}
