import { VerifyContent } from './verify-content'

export default function VerifyPage() {
  const protocol = process.env.NODE_ENV === 'development' ? 'http' : 'https'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'localhost:3000'
  const baseUrl = `${protocol}://${appUrl}`

  const hasResendKey = Boolean(
    process.env.RESEND_API_KEY && 
    process.env.RESEND_API_KEY !== 'placeholder'
  )
  const isProduction = process.env.NODE_ENV === 'production'

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h1 className="text-2xl font-bold text-center mb-8">Sim Studio</h1>
        <VerifyContent 
          hasResendKey={hasResendKey} 
          baseUrl={baseUrl} 
          isProduction={isProduction} 
        />
      </div>
    </main>
  )
}
