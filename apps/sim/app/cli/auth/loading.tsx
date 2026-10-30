import { AuthSkeleton as Skeleton } from '@sim/auth-ui'
import { AuthShell } from '@/app/(auth)/components'

/**
 * Consent-card skeleton, shared by the route fallback and `page.tsx`'s Suspense.
 *
 * Bars mirror the card's boxes so hydration doesn't shift the layout: a
 * one-line heading, a description that wraps to two in the 400px column, then
 * the 70px pairing panel (28px type + `py-5` + 1px border) and the `h-9` button.
 */
export function CliAuthLoading() {
  return (
    <div className='au:flex au:w-full au:flex-col au:items-center'>
      <Skeleton className='au:h-[38px] au:w-[280px] au:rounded-[4px]' />
      <Skeleton className='au:mt-1 au:h-[23px] au:w-[360px] au:rounded-[4px]' />
      <Skeleton className='au:h-[23px] au:w-[240px] au:rounded-[4px]' />
      <Skeleton className='au:h-[70px] au:w-full au:rounded-[10px]' />
      <Skeleton className='au:h-9 au:w-full au:rounded-[10px]' />
    </div>
  )
}

export default function CliAuthRouteLoading() {
  return (
    <AuthShell>
      <CliAuthLoading />
    </AuthShell>
  )
}
