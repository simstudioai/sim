import { env } from '@/lib/env'
import { isProd } from '@/lib/environment'
import { VerifyContent } from '@/app/(auth)/verify/verify-content'

export const dynamic = 'force-dynamic'

export default function VerifyPage() {
  const hasResendKey = Boolean(env.RESEND_API_KEY)

  return <VerifyContent hasResendKey={hasResendKey} isProduction={isProd} />
}
