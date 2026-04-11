import { Skeleton } from '@/components/emcn'

export function AuditLogsSkeleton() {
  return (
    <div className='flex h-full flex-col gap-4.5'>
      <div className='flex items-center gap-2'>
        <Skeleton className='h-[38px] flex-1 rounded-lg' />
        <Skeleton className='h-[38px] w-[160px] rounded-lg' />
        <Skeleton className='h-[38px] w-[140px] rounded-lg' />
      </div>
      <div className='flex items-center gap-4 border-[var(--border)] border-b pb-2'>
        <Skeleton className='h-4 w-[140px]' />
        <Skeleton className='h-4 w-[120px]' />
        <Skeleton className='h-4 flex-1' />
        <Skeleton className='h-4 w-[140px]' />
      </div>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className='flex items-center gap-4'>
          <Skeleton className='h-4 w-[140px]' />
          <Skeleton className='h-4 w-[120px]' />
          <Skeleton className='h-4 flex-1' />
          <Skeleton className='h-4 w-[140px]' />
        </div>
      ))}
    </div>
  )
}
