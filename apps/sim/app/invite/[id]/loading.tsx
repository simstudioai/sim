import { AuthSkeleton as Skeleton } from '@sim/emcn-auth/loading'
import { AuthStack } from '@sim/emcn-auth/stack'
import { InviteLayout } from '@/app/invite/components'

export default function InviteLoading() {
  return (
    <InviteLayout>
      <AuthStack>
        <div className='au:flex au:flex-col au:gap-1'>
          <Skeleton shape='title' className='au:w-[200px]' />
          <Skeleton shape='label' className='au:w-[280px]' />
          <Skeleton shape='label' className='au:w-[240px]' />
        </div>
        <Skeleton />
      </AuthStack>
    </InviteLayout>
  )
}
