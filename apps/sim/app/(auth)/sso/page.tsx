import { redirect } from 'next/navigation'
import { getEnv, isTruthy } from '@/lib/env'
import SSOForm from './sso-form'

export const dynamic = 'force-dynamic'

export default async function SSOPage() {
  if (!isTruthy(getEnv('NEXT_PUBLIC_SSO_ENABLED'))) {
    redirect('/login')
  }

  return <SSOForm />
}
