import { AuthSkeleton, AuthStack } from '@sim/auth-ui'
import { InviteLayout } from '@/app/invite/components'

export default function UnsubscribeLoading() {
  return (
    <InviteLayout>
      <AuthStack>
        <div className='au:space-y-1'>
          <AuthSkeleton shape='title' className='au:w-[180px]' />
          <AuthSkeleton shape='label' className='au:w-[300px]' />
        </div>
        <AuthSkeleton />
      </AuthStack>
    </InviteLayout>
  )
}
