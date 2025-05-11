import { ShieldCheck } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { InstructionsSection } from '../ui/instructions-section'
import { TestResultDisplay } from '../ui/test-result'

interface StripeConfigProps {
  isLoadingToken: boolean
  testResult: {
    success: boolean
    message?: string
    test?: any
  } | null
  copied: string | null
  copyToClipboard: (text: string, type: string) => void
}

export function StripeConfig({ testResult, copied, copyToClipboard }: StripeConfigProps) {
  return (
    <div className="space-y-4">
      {/* No specific config fields for Stripe, just instructions */}

      <TestResultDisplay
        testResult={testResult}
        copied={copied}
        copyToClipboard={copyToClipboard}
        showCurlCommand={false} // Stripe requires signed requests, curl test not applicable here
      />

      <InstructionsSection tip="Stripe will send a test event to verify your webhook endpoint after adding it.">
        <ol className="list-decimal list-inside space-y-1">
          <li>
            Go to your{' '}
            <a
              href="https://dashboard.stripe.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="link"
            >
              Stripe Dashboard
            </a>
            .
          </li>
          <li>Navigate to Developers {'>'} Webhooks.</li>
          <li>Click "Add endpoint".</li>
          <li>
            Paste the <strong>Webhook URL</strong> (from above) into the "Endpoint URL" field.
          </li>
          <li>Select the events you want to listen to (e.g., `charge.succeeded`).</li>
          <li>Click "Add endpoint".</li>
        </ol>
      </InstructionsSection>

      <Alert>
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Webhook Signing</AlertTitle>
        <AlertDescription>
          For production use, it's highly recommended to verify Stripe webhook signatures to ensure
          requests are genuinely from Stripe. Sim Studio handles this automatically if you provide
          the signing secret during setup (coming soon).
        </AlertDescription>
      </Alert>
    </div>
  )
}
