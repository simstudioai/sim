import { AuthStack, AuthSkeleton as Skeleton } from '@sim/auth-ui'
import { AuthShell } from '@/app/(auth)/components'

/** Mirrors the terminal consent header, pairing code, and approval control. */
export function CliAuthLoading() {
  return (
    <AuthStack>
      <div className='au:space-y-1'>
        <Skeleton shape='title' className='au:w-[280px]' />
        <Skeleton shape='label' className='au:w-[360px]' />
        <Skeleton shape='label' className='au:w-[240px]' />
      </div>
      <Skeleton />
      <Skeleton />
    </AuthStack>
  )
}

export default function CliAuthRouteLoading() {
  return (
    <AuthShell>
      <CliAuthLoading />
    </AuthShell>
  )
}
