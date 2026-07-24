import { Skeleton } from '@sim/emcn'
import { AuthShell } from '@/app/(auth)/components'

/**
 * Consent-card skeleton, shared by the route fallback and `page.tsx`'s Suspense.
 *
 * Bars mirror the card's boxes so hydration doesn't shift the layout: the
 * heading and description each wrap to two lines in the 400px column, then the
 * 70px pairing panel (28px type + `py-5` + 1px border) and the `h-9` button.
 */
export function CliAuthLoading() {
  return (
    <div className='flex w-full flex-col items-center'>
      <Skeleton className='h-[38px] w-[300px] rounded-[4px]' />
      <Skeleton className='h-[38px] w-[220px] rounded-[4px]' />
      <Skeleton className='mt-1 h-[23px] w-[340px] rounded-[4px]' />
      <Skeleton className='h-[23px] w-[260px] rounded-[4px]' />
      <Skeleton className='mt-6 h-[70px] w-full rounded-[10px]' />
      <Skeleton className='mt-4 h-9 w-full rounded-[10px]' />
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
