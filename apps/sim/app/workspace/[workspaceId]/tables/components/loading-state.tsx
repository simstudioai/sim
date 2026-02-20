export function LoadingState() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className='flex h-full flex-col gap-[12px] rounded-[4px] bg-[var(--surface-3)] px-[8px] py-[6px] dark:bg-[var(--surface-4)]'
        >
          <div className='flex items-center justify-between gap-[8px]'>
            <div className='h-[17px] w-[120px] animate-pulse rounded-[4px] bg-[var(--surface-4)] dark:bg-[var(--surface-5)]' />
            <div className='h-[22px] w-[90px] animate-pulse rounded-[4px] bg-[var(--surface-4)] dark:bg-[var(--surface-5)]' />
          </div>
          <div className='flex flex-1 flex-col gap-[8px]'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-[12px]'>
                <div className='h-[15px] w-[50px] animate-pulse rounded-[4px] bg-[var(--surface-4)] dark:bg-[var(--surface-5)]' />
                <div className='h-[15px] w-[50px] animate-pulse rounded-[4px] bg-[var(--surface-4)] dark:bg-[var(--surface-5)]' />
              </div>
              <div className='h-[15px] w-[60px] animate-pulse rounded-[4px] bg-[var(--surface-4)] dark:bg-[var(--surface-5)]' />
            </div>
            <div className='h-0 w-full border-[var(--divider)] border-t' />
            <div className='flex h-[36px] flex-col gap-[6px]'>
              <div className='h-[15px] w-full animate-pulse rounded-[4px] bg-[var(--surface-4)] dark:bg-[var(--surface-5)]' />
              <div className='h-[15px] w-[75%] animate-pulse rounded-[4px] bg-[var(--surface-4)] dark:bg-[var(--surface-5)]' />
            </div>
          </div>
        </div>
      ))}
    </>
  )
}
