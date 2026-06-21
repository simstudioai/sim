/**
 * Suspense fallback for the home/Chat surface. `Home` reads the `?resource=`
 * URL param via nuqs (`useQueryState`, which uses `useSearchParams`
 * internally), so it must sit under a Suspense boundary. This renders the
 * surface background so a suspend never flashes a blank frame before the chat
 * mounts.
 */
export function HomeFallback() {
  return <div className='h-full bg-[var(--bg)]' />
}
