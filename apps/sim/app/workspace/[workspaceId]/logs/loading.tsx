export default function LogsLoading() {
  return (
    <div className='flex h-full flex-1 flex-col overflow-hidden'>
      <div className='flex flex-1 overflow-hidden'>
        <div className='flex flex-1 flex-col overflow-auto bg-white pt-[28px] pl-[24px] dark:bg-[var(--bg)]'>
          <div className='flex items-center gap-[12px] pr-[24px]'>
            <div className='h-[32px] w-[240px] animate-pulse rounded-[8px] bg-[var(--surface-4)]' />
            <div className='h-[32px] w-[100px] animate-pulse rounded-[6px] bg-[var(--surface-5)]' />
            <div className='ml-auto h-[32px] w-[80px] animate-pulse rounded-[6px] bg-[var(--surface-5)]' />
          </div>

          <div className='relative mt-[24px] flex min-h-0 flex-1 flex-col overflow-hidden rounded-[6px] pr-[24px]'>
            <div className='flex min-h-0 flex-1 flex-col overflow-hidden rounded-[6px] bg-[var(--surface-2)] dark:bg-[var(--surface-1)]'>
              <div className='flex-shrink-0 rounded-t-[6px] bg-[var(--surface-3)] px-[24px] py-[10px] dark:bg-[var(--surface-3)]'>
                <div className='flex items-center gap-[16px]'>
                  <div className='h-3 w-[120px] animate-pulse rounded bg-[var(--surface-5)]' />
                  <div className='h-3 w-[80px] animate-pulse rounded bg-[var(--surface-5)]' />
                  <div className='h-3 w-[100px] animate-pulse rounded bg-[var(--surface-5)]' />
                  <div className='h-3 w-[60px] animate-pulse rounded bg-[var(--surface-5)]' />
                  <div className='h-3 w-[80px] animate-pulse rounded bg-[var(--surface-5)]' />
                </div>
              </div>
              <div className='flex-1 px-[24px]'>
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className='flex items-center gap-[16px] border-[var(--border)] border-b py-[10px]'
                  >
                    <div className='h-4 w-[120px] animate-pulse rounded bg-[var(--surface-5)]' />
                    <div className='h-4 w-[60px] animate-pulse rounded bg-[var(--surface-5)]' />
                    <div className='h-4 w-[90px] animate-pulse rounded bg-[var(--surface-5)]' />
                    <div className='h-4 w-[50px] animate-pulse rounded bg-[var(--surface-5)]' />
                    <div className='h-4 w-[70px] animate-pulse rounded bg-[var(--surface-5)]' />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
