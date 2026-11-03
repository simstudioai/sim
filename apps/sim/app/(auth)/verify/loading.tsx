import {
  AuthLoadingFrame,
  AuthLoadingSkeleton,
} from '@/app/(auth)/components/auth-loading-skeleton'

export default function VerifyLoading() {
  return (
    <AuthLoadingFrame>
      <AuthLoadingSkeleton shape='title' className='au:w-[180px]' />
      <AuthLoadingSkeleton shape='label' className='au:w-[300px]' />
      <AuthLoadingSkeleton shape='label' className='au:w-[240px]' />
      <AuthLoadingSkeleton shape='control' className='au:w-full' />
    </AuthLoadingFrame>
  )
}
