import { AuthSkeleton as Skeleton } from '@sim/emcn-auth/loading'
import { AuthStack } from '@sim/emcn-auth/stack'
import { AuthShell } from '@/app/(auth)/components'

/** Mirrors the terminal consent header, pairing code, and approval control. */
export function CliAuthLoading() {
  return (
    <AuthStack>
      <div className='au:flex au:flex-col au:gap-1'>
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
