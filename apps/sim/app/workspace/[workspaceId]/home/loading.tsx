/**
 * Loading skeleton for the Home chat page.
 * Matches the empty-state centered layout with title + input area.
 */
export default function HomeLoading() {
  return (
    <div className='flex h-full flex-col items-center justify-center bg-[#FCFCFC] px-[24px] dark:bg-[var(--surface-2)]'>
      {/* Title placeholder */}
      <div className='mb-[24px] h-[38px] w-[320px] animate-pulse rounded-[8px] bg-[var(--surface-5)]' />
      {/* Input area placeholder */}
      <div className='w-full max-w-[640px]'>
        <div className='h-[52px] w-full animate-pulse rounded-[16px] bg-[var(--surface-5)]' />
      </div>
    </div>
  )
}
