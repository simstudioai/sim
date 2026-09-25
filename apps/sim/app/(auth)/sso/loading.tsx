import {
  AuthLoadingField,
  AuthLoadingFrame,
  AuthLoadingSkeleton,
} from '@/app/(auth)/components/auth-loading-skeleton'

export default function SSOLoading() {
  return (
    <AuthLoadingFrame>
      <AuthLoadingSkeleton shape='title' className='w-[120px]' />
      <AuthLoadingSkeleton shape='label' className='mt-3 w-[260px]' />
      <AuthLoadingField labelWidthClassName='w-[80px]' className='mt-8' />
      <AuthLoadingSkeleton shape='control' className='mt-6 w-full' />
      <AuthLoadingSkeleton shape='label' className='mt-6 w-[120px]' />
    </AuthLoadingFrame>
  )
}
