import {
  AuthLoadingField,
  AuthLoadingFrame,
  AuthLoadingSkeleton,
} from '@/app/(auth)/components/auth-loading-skeleton'

export default function ResetPasswordLoading() {
  return (
    <AuthLoadingFrame>
      <AuthLoadingSkeleton shape='title' className='au:w-[160px]' />
      <AuthLoadingSkeleton shape='label' className='au:w-[280px]' />
      <AuthLoadingField labelWidthClassName='au:w-[40px]' />
      <AuthLoadingSkeleton shape='control' className='au:w-full' />
      <AuthLoadingSkeleton shape='label' className='au:w-[120px]' />
    </AuthLoadingFrame>
  )
}
