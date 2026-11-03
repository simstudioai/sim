import {
  AuthLoadingAlternateActions,
  AuthLoadingField,
  AuthLoadingFrame,
  AuthLoadingSkeleton,
} from '@/app/(auth)/components/auth-loading-skeleton'

export default function SignupLoading() {
  return (
    <AuthLoadingFrame>
      <AuthLoadingSkeleton shape='title' className='au:w-[100px]' />
      <AuthLoadingField labelWidthClassName='au:w-[40px]' />
      <AuthLoadingField labelWidthClassName='au:w-[40px]' />
      <AuthLoadingField labelWidthClassName='au:w-[64px]' />
      <AuthLoadingSkeleton shape='control' className='au:w-full' />
      <AuthLoadingAlternateActions />
      <AuthLoadingSkeleton shape='label' className='au:w-[220px]' />
    </AuthLoadingFrame>
  )
}
