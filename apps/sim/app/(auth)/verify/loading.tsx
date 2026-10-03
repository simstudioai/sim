import {
  AuthLoadingFrame,
  AuthLoadingSkeleton,
} from '@/app/(auth)/components/auth-loading-skeleton'

export default function VerifyLoading() {
  return (
    <AuthLoadingFrame>
      <AuthLoadingSkeleton shape='title' className='w-[180px]' />
      <AuthLoadingSkeleton shape='label' className='mt-3 w-[300px]' />
      <AuthLoadingSkeleton shape='label' className='mt-1 w-[240px]' />
      <AuthLoadingSkeleton shape='control' className='mt-8 w-full' />
    </AuthLoadingFrame>
  )
}
