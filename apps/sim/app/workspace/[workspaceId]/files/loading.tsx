export default function FilesLoading() {
  return (
    <div className='flex h-full flex-1 flex-col'>
      <div className='flex flex-1 overflow-hidden'>
        <div className='flex flex-1 flex-col overflow-auto bg-white px-[24px] pt-[28px] pb-[24px] dark:bg-[var(--bg)]'>
          <div>
            <div className='flex items-start gap-[12px]'>
              <div className='flex h-[26px] w-[26px] animate-pulse items-center justify-center rounded-[6px] border border-[#8B5CF6] bg-[#F5F3FF] dark:border-[#5B21B6] dark:bg-[#2E1065]' />
              <div className='h-[22px] w-[50px] animate-pulse rounded bg-[var(--surface-5)]' />
            </div>
            <div className='mt-[10px] h-[18px] w-[360px] animate-pulse rounded bg-[var(--surface-5)]' />
          </div>

          <div className='mt-[14px] flex items-center justify-between'>
            <div className='h-[32px] w-[400px] animate-pulse rounded-[8px] bg-[var(--surface-4)]' />
            <div className='h-[32px] w-[80px] animate-pulse rounded-[6px] bg-[var(--surface-5)]' />
          </div>

          <div className='mt-[24px]'>
            <div className='flex items-center border-b py-[8px]'>
              <div className='w-[56%] px-[12px]'>
                <div className='h-3 w-[40px] animate-pulse rounded bg-[var(--surface-5)]' />
              </div>
              <div className='w-[14%] px-[12px]'>
                <div className='h-3 w-[30px] animate-pulse rounded bg-[var(--surface-5)]' />
              </div>
              <div className='w-[15%] px-[12px]'>
                <div className='h-3 w-[60px] animate-pulse rounded bg-[var(--surface-5)]' />
              </div>
              <div className='w-[15%] px-[12px]'>
                <div className='h-3 w-[50px] animate-pulse rounded bg-[var(--surface-5)]' />
              </div>
            </div>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className='flex items-center border-b py-[8px]'>
                <div className='w-[56%] px-[12px]'>
                  <div className='h-4 w-[70%] animate-pulse rounded bg-[var(--surface-5)]' />
                </div>
                <div className='w-[14%] px-[12px]'>
                  <div className='h-4 w-[50px] animate-pulse rounded bg-[var(--surface-5)]' />
                </div>
                <div className='w-[15%] px-[12px]'>
                  <div className='h-4 w-[70px] animate-pulse rounded bg-[var(--surface-5)]' />
                </div>
                <div className='w-[15%] px-[12px]'>
                  <div className='h-4 w-[40px] animate-pulse rounded bg-[var(--surface-5)]' />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
