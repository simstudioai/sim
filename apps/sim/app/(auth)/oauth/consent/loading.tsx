import { Skeleton } from '@sim/emcn'
import { AuthShell } from '@/app/(auth)/components'

/**
 * Consent-card skeleton, shared by the route fallback and the card itself
 * while it resolves the client's registered name.
 *
 * Bars mirror the card so nothing shifts when it arrives: a one-line heading,
 * a description that wraps to two in the 400px column, the scope panel at its
 * tallest real height, then the two `h-9` actions with the `space-y-4` gap the
 * card renders.
 *
 * Sized for the Sim CLI, which is the client nearly every visitor arrives
 * from: it asks for `offline_access api:read api:write`, and
 * `visibleOAuthScopes` folds `api:read` into `api:write`, so two rows render.
 * `py-3` (24) + two 20px rows + one 8px gap + 2px of border. A third-party
 * client asking for more shifts the card down a little when it resolves.
 */
export function OAuthConsentLoading() {
  return (
    <div className='flex w-full flex-col items-center'>
      <Skeleton className='h-[38px] w-[260px] rounded-[4px]' />
      <Skeleton className='mt-1 h-[23px] w-[360px] rounded-[4px]' />
      <Skeleton className='h-[23px] w-[240px] rounded-[4px]' />
      <Skeleton className='mt-6 h-[74px] w-full rounded-[10px]' />
      <Skeleton className='mt-4 h-[20px] w-[240px] rounded-[4px]' />
      <Skeleton className='mt-4 h-9 w-full rounded-[10px]' />
      <Skeleton className='mt-4 h-9 w-full rounded-[10px]' />
    </div>
  )
}

export default function OAuthConsentRouteLoading() {
  return (
    <AuthShell>
      <OAuthConsentLoading />
    </AuthShell>
  )
}
