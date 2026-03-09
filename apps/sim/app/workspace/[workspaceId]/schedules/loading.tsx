/**
 * Loading skeleton for the Schedules page.
 * Matches the layout: amber icon badge + title + description + search bar + two table sections.
 */
export default function SchedulesLoading() {
  return (
    <div className='flex h-full flex-1 flex-col'>
      <div className='flex flex-1 overflow-hidden'>
        <div className='flex flex-1 flex-col overflow-auto bg-white px-[24px] pt-[28px] pb-[24px] dark:bg-[var(--bg)]'>
          {/* Header: icon badge + title */}
          <div>
            <div className='flex items-start gap-[12px]'>
              <div className='flex h-[26px] w-[26px] animate-pulse items-center justify-center rounded-[6px] border border-[#F59E0B] bg-[#FFFBEB] dark:border-[#B45309] dark:bg-[#451A03]' />
              <div className='h-[22px] w-[90px] animate-pulse rounded bg-[var(--surface-5)]' />
            </div>
            {/* Description */}
            <div className='mt-[10px] h-[18px] w-[400px] animate-pulse rounded bg-[var(--surface-5)]' />
          </div>

          {/* Toolbar: search only */}
          <div className='mt-[14px]'>
            <div className='h-[32px] w-[400px] animate-pulse rounded-[8px] bg-[var(--surface-4)]' />
          </div>

          {/* Two table sections */}
          <div className='mt-[24px] space-y-[32px]'>
            {/* Schedules section */}
            <section>
              <div className='mb-[12px] h-[18px] w-[80px] animate-pulse rounded bg-[var(--surface-5)]' />
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className='flex items-center border-b py-[8px]'>
                  <div className='w-[30%] px-[12px]'>
                    <div className='h-4 w-[80%] animate-pulse rounded bg-[var(--surface-5)]' />
                  </div>
                  <div className='w-[26%] px-[12px]'>
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
            </section>

            {/* Jobs section */}
            <section>
              <div className='mb-[12px] h-[18px] w-[40px] animate-pulse rounded bg-[var(--surface-5)]' />
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className='flex items-center border-b py-[8px]'>
                  <div className='w-[30%] px-[12px]'>
                    <div className='h-4 w-[75%] animate-pulse rounded bg-[var(--surface-5)]' />
                  </div>
                  <div className='w-[26%] px-[12px]'>
                    <div className='h-4 w-[60%] animate-pulse rounded bg-[var(--surface-5)]' />
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
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
