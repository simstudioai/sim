import { isProd } from '@/lib/environment'
import { getBaseUrl } from '@/lib/urls/utils'
import { VerifyContent } from './verify-content'

// Force dynamic rendering to avoid prerender errors with search params
export const dynamic = 'force-dynamic'

export default function VerifyPage() {
  const baseUrl = getBaseUrl()

  const hasResendKey = Boolean(
    process.env.RESEND_API_KEY && process.env.RESEND_API_KEY !== 'placeholder'
  )

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h1 className="text-2xl font-bold text-center mb-8">Sim Studio</h1>
        <VerifyContent hasResendKey={hasResendKey} baseUrl={baseUrl} isProduction={isProd} />
      </div>
    </main>
  )
}
