export default function SettingsLoading() {
  return (
    <div>
      <div className='mb-[28px] h-[28px] w-[100px] animate-pulse rounded bg-[var(--surface-5)]' />

      <div className='space-y-[24px]'>
        <div>
          <div className='mb-[8px] h-[14px] w-[80px] animate-pulse rounded bg-[var(--surface-5)]' />
          <div className='h-[40px] w-full animate-pulse rounded-[8px] bg-[var(--surface-4)]' />
        </div>
        <div>
          <div className='mb-[8px] h-[14px] w-[120px] animate-pulse rounded bg-[var(--surface-5)]' />
          <div className='h-[40px] w-full animate-pulse rounded-[8px] bg-[var(--surface-4)]' />
        </div>
        <div>
          <div className='mb-[8px] h-[14px] w-[60px] animate-pulse rounded bg-[var(--surface-5)]' />
          <div className='h-[40px] w-3/4 animate-pulse rounded-[8px] bg-[var(--surface-4)]' />
        </div>
      </div>
    </div>
  )
}
