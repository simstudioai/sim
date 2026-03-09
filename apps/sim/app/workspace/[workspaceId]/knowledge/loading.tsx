export default function KnowledgeLoading() {
  return (
    <div className='flex h-full flex-1 flex-col'>
      <div className='flex flex-1 overflow-hidden'>
        <div className='flex flex-1 flex-col overflow-auto bg-white px-[24px] pt-[28px] pb-[24px] dark:bg-[var(--bg)]'>
          <div>
            <div className='flex items-start gap-[12px]'>
              <div className='flex h-[26px] w-[26px] animate-pulse items-center justify-center rounded-[6px] border border-[#5BB377] bg-[#E8F7EE] dark:border-[#1E5A3E] dark:bg-[#0F3D2C]' />
              <div className='h-[22px] w-[140px] animate-pulse rounded bg-[var(--surface-5)]' />
            </div>
            <div className='mt-[10px] h-[18px] w-[340px] animate-pulse rounded bg-[var(--surface-5)]' />
          </div>

          <div className='mt-[14px] flex items-center justify-between'>
            <div className='h-[32px] w-[400px] animate-pulse rounded-[8px] bg-[var(--surface-4)]' />
            <div className='h-[32px] w-[80px] animate-pulse rounded-[6px] bg-[var(--surface-5)]' />
          </div>

          <div className='mt-[24px] grid grid-cols-1 gap-[20px] md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className='h-[120px] animate-pulse rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)]'
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
