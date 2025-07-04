import { Skeleton } from '@/components/ui/skeleton'

export function TeamManagementSkeleton() {
  return (
    <div className='space-y-6 p-6'>
      <div className='flex items-center justify-between'>
        <Skeleton className='h-6 w-40' />
        <Skeleton className='h-9 w-32' />
      </div>

      <div className='space-y-4'>
        <div className='rounded-md border p-4'>
          <Skeleton className='mb-4 h-5 w-32' />
          <div className='flex items-center space-x-2'>
            <Skeleton className='h-9 flex-1' />
            <Skeleton className='h-9 w-24' />
          </div>
        </div>

        <div className='rounded-md border p-4'>
          <Skeleton className='mb-4 h-5 w-32' />
          <div className='space-y-2'>
            <div className='flex justify-between'>
              <Skeleton className='h-4 w-16' />
              <Skeleton className='h-4 w-24' />
            </div>
            <Skeleton className='h-2 w-full' />
            <div className='mt-4 flex justify-between'>
              <Skeleton className='h-9 w-24' />
              <Skeleton className='h-9 w-24' />
            </div>
          </div>
        </div>

        <div className='rounded-md border'>
          <Skeleton className='h-5 w-32 border-b p-4' />
          <div className='space-y-4 p-4'>
            {[1, 2, 3].map((i) => (
              <div key={i} className='flex items-center justify-between'>
                <div className='space-y-2'>
                  <Skeleton className='h-5 w-32' />
                  <Skeleton className='h-4 w-48' />
                  <Skeleton className='h-4 w-16' />
                </div>
                <Skeleton className='h-9 w-9' />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
