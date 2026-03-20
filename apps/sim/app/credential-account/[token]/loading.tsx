import { Skeleton } from '@/components/emcn'

export default function CredentialAccountLoading() {
  return (
    <main className='relative flex min-h-screen flex-col text-foreground'>
      <div className='relative z-30 flex flex-1 items-center justify-center px-4 pb-24'>
        <div className='w-full max-w-lg px-4'>
          <div className='flex flex-col items-center justify-center'>
            <Skeleton className='h-[48px] w-[48px] rounded-[12px]' />
            <Skeleton className='mt-[16px] h-[24px] w-[200px] rounded-[4px]' />
            <Skeleton className='mt-[8px] h-[14px] w-[280px] rounded-[4px]' />
            <Skeleton className='mt-[4px] h-[14px] w-[240px] rounded-[4px]' />
            <Skeleton className='mt-[24px] h-[44px] w-[200px] rounded-[10px]' />
          </div>
        </div>
      </div>
    </main>
  )
}
