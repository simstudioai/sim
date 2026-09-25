import {
  AuthLoadingAlternateActions,
  AuthLoadingField,
  AuthLoadingFrame,
  AuthLoadingSkeleton,
} from '@/app/(auth)/components/auth-loading-skeleton'

export default function LoginLoading() {
  return (
    <AuthLoadingFrame>
      <AuthLoadingSkeleton shape='title' className='w-[80px]' />
      <AuthLoadingField labelWidthClassName='w-[40px]' className='mt-8' />
      <AuthLoadingField labelWidthClassName='w-[64px]' className='mt-4' />
      <AuthLoadingSkeleton shape='control' className='mt-6 w-full' />
      <AuthLoadingAlternateActions />
      <AuthLoadingSkeleton shape='label' className='mt-6 w-[200px]' />
    </AuthLoadingFrame>
  )
}
