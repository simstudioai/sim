import { redirect } from 'next/navigation'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import SSOForm from '@/ee/sso/components/sso-form'

export const dynamic = 'force-dynamic'

export default async function SSOPage() {
  if (!isTruthy(getEnv('NEXT_PUBLIC_SSO_ENABLED'))) {
    redirect('/login')
  }

  return <SSOForm />
}
