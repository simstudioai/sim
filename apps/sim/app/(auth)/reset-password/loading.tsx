import {
  AuthLoadingField,
  AuthLoadingFrame,
  AuthLoadingSkeleton,
} from '@/app/(auth)/components/auth-loading-skeleton'

export default function ResetPasswordLoading() {
  return (
    <AuthLoadingFrame>
      <AuthLoadingSkeleton shape='title' className='w-[160px]' />
      <AuthLoadingSkeleton shape='label' className='mt-3 w-[280px]' />
      <AuthLoadingField labelWidthClassName='w-[40px]' className='mt-8' />
      <AuthLoadingSkeleton shape='control' className='mt-6 w-full' />
      <AuthLoadingSkeleton shape='label' className='mt-6 w-[120px]' />
    </AuthLoadingFrame>
  )
}
