import { CheckCircle, Network } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ConfigField } from '../ui/config-field'
import { ConfigSection } from '../ui/config-section'
import { CopyableField } from '../ui/copyable'
import { InstructionsSection } from '../ui/instructions-section'
import { TestResultDisplay } from '../ui/test-result'

interface WhatsAppConfigProps {
  verificationToken: string
  setVerificationToken: (token: string) => void
  isLoadingToken: boolean
  testResult: {
    success: boolean
    message?: string
    test?: any
  } | null
  copied: string | null
  copyToClipboard: (text: string, type: string) => void
}

export function WhatsAppConfig({
  verificationToken,
  setVerificationToken,
  isLoadingToken,
  testResult,
  copied,
  copyToClipboard,
}: WhatsAppConfigProps) {
  return (
    <div className="space-y-4">
      <ConfigSection title="WhatsApp Configuration">
        <ConfigField
          id="whatsapp-verification-token"
          label="Verification Token"
          description="Enter any secure token here. You'll need to provide the same token in your WhatsApp Business Platform dashboard."
        >
          <CopyableField
            id="whatsapp-verification-token"
            value={verificationToken}
            onChange={setVerificationToken}
            placeholder="Generate or enter a verification token"
            isLoading={isLoadingToken}
            copied={copied}
            copyType="whatsapp-token"
            copyToClipboard={copyToClipboard}
            isSecret // Treat as secret
          />
        </ConfigField>
      </ConfigSection>

      <TestResultDisplay
        testResult={testResult}
        copied={copied}
        copyToClipboard={copyToClipboard}
        showCurlCommand={false} // WhatsApp uses GET for verification, not simple POST
      />

      <InstructionsSection tip="After saving, click 'Verify and save' in WhatsApp and subscribe to the 'messages' webhook field.">
        <ol className="list-decimal list-inside space-y-1">
          <li>
            Go to your{' '}
            <a
              href="https://developers.facebook.com/apps/"
              target="_blank"
              rel="noopener noreferrer"
              className="link"
            >
              Meta for Developers Apps
            </a>{' '}
            page.
          </li>
          <li>Select your App, then navigate to WhatsApp {'>'} Configuration.</li>
          <li>Find the Webhooks section and click "Edit".</li>
          <li>
            Paste the <strong>Webhook URL</strong> (from above) into the "Callback URL" field.
          </li>
          <li>
            Paste the <strong>Verification Token</strong> (from above) into the "Verify token"
            field.
          </li>
          <li>Click "Verify and save".</li>
          <li>Click "Manage" next to Webhook fields and subscribe to `messages`.</li>
        </ol>
      </InstructionsSection>

      <Alert>
        <Network className="h-4 w-4" />
        <AlertTitle>Requirements</AlertTitle>
        <AlertDescription>
          <ul className="list-disc list-outside pl-4 space-y-1 mt-1">
            <li>Your Sim Studio webhook URL must use HTTPS and be publicly accessible.</li>
            <li>Self-signed SSL certificates are not supported by WhatsApp.</li>
            <li>For local testing, use a tunneling service like ngrok or Cloudflare Tunnel.</li>
          </ul>
        </AlertDescription>
      </Alert>
    </div>
  )
}
