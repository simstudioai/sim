import { env } from '@/lib/env'
import { isProd } from '@/lib/environment'
import { getBaseUrl } from '@/lib/urls/utils'
import { VerifyContent } from './verify-content'

// Force dynamic rendering to avoid prerender errors with search params
export const dynamic = 'force-dynamic'

export default function VerifyPage() {
  const baseUrl = getBaseUrl()
  const hasResendKey = Boolean(env.RESEND_API_KEY && env.RESEND_API_KEY !== 'placeholder')

  return <VerifyContent hasResendKey={hasResendKey} baseUrl={baseUrl} isProduction={isProd} />
}
