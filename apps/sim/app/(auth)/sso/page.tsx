import { redirect } from 'next/navigation'
import { env, isTruthy } from '@/lib/env'
import SSOForm from './sso-form'

// Force dynamic rendering to avoid prerender errors with search params
export const dynamic = 'force-dynamic'

export default async function SSOPage() {
  // Redirect if SSO is not enabled
  if (!isTruthy(env.NEXT_PUBLIC_SSO_ENABLED)) {
    redirect('/login')
  }

  return <SSOForm />
}
