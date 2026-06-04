import type { Metadata } from 'next'
import ResetPasswordPage from '@/app/(auth)/reset-password/reset-password-content'

export const metadata: Metadata = {
  title: 'Reset Password',
}

export const dynamic = 'force-dynamic'

export default ResetPasswordPage
