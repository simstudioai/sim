import { Loader } from '@sim/emcn/icons'

/** Kept apart from the dashboard renderer so the route's loading fallback stays light. */
export function DashboardLoading() {
  return (
    <div role='status' className='flex flex-1 items-center justify-center'>
      <Loader animate className='size-[16px] text-[var(--text-icon)]' />
      <span className='sr-only'>Loading dashboard</span>
    </div>
  )
}
