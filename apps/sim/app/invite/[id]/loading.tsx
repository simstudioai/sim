import { AuthStack, AuthSkeleton as Skeleton } from '@sim/auth-ui'
import { InviteLayout } from '@/app/invite/components'

export default function InviteLoading() {
  return (
    <InviteLayout>
      <AuthStack>
        <div className='au:space-y-1'>
          <Skeleton shape='title' className='au:w-[200px]' />
          <Skeleton shape='label' className='au:w-[280px]' />
          <Skeleton shape='label' className='au:w-[240px]' />
        </div>
        <Skeleton />
      </AuthStack>
    </InviteLayout>
  )
}
