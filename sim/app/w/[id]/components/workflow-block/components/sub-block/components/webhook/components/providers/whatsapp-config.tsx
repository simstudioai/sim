import { CopyableField } from '../ui/copyable'
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
      <CopyableField
        id="whatsapp-verification-token"
        label="Verification Token"
        value={verificationToken}
        onChange={setVerificationToken}
        placeholder="Enter a verification token for WhatsApp"
        description="This token will be used to verify your webhook with WhatsApp."
        isLoading={isLoadingToken}
        copied={copied}
        copyType="token"
        copyToClipboard={copyToClipboard}
      />

      <TestResultDisplay
        testResult={testResult}
        copied={copied}
        copyToClipboard={copyToClipboard}
      />

      <div className="space-y-2">
        <h4 className="font-medium">Setup Instructions</h4>
        <ol className="space-y-2">
          <li className="flex items-start">
            <span className="text-gray-500 dark:text-gray-400 mr-2">1.</span>
            <span className="text-sm">Go to WhatsApp Business Platform dashboard</span>
          </li>
          <li className="flex items-start">
            <span className="text-gray-500 dark:text-gray-400 mr-2">2.</span>
            <span className="text-sm">Navigate to "Configuration" in the sidebar</span>
          </li>
          <li className="flex items-start">
            <span className="text-gray-500 dark:text-gray-400 mr-2">3.</span>
            <span className="text-sm">
              Enter the URL above as "Callback URL" (exactly as shown)
            </span>
          </li>
          <li className="flex items-start">
            <span className="text-gray-500 dark:text-gray-400 mr-2">4.</span>
            <span className="text-sm">Enter your token as "Verify token"</span>
          </li>
          <li className="flex items-start">
            <span className="text-gray-500 dark:text-gray-400 mr-2">5.</span>
            <span className="text-sm">Click "Verify and save" and subscribe to "messages"</span>
          </li>
        </ol>
        <div className="bg-blue-50 dark:bg-blue-950 p-3 rounded-md mt-3 border border-blue-200 dark:border-blue-800">
          <h5 className="text-sm font-medium text-blue-800 dark:text-blue-300">Requirements</h5>
          <ul className="mt-1 space-y-1">
            <li className="flex items-start">
              <span className="text-blue-500 dark:text-blue-400 mr-2">•</span>
              <span className="text-sm text-blue-700 dark:text-blue-300">
                URL must be publicly accessible with HTTPS
              </span>
            </li>
            <li className="flex items-start">
              <span className="text-blue-500 dark:text-blue-400 mr-2">•</span>
              <span className="text-sm text-blue-700 dark:text-blue-300">
                Self-signed SSL certificates not supported
              </span>
            </li>
            <li className="flex items-start">
              <span className="text-blue-500 dark:text-blue-400 mr-2">•</span>
              <span className="text-sm text-blue-700 dark:text-blue-300">
                For local testing, use ngrok to expose your server
              </span>
            </li>
          </ul>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-md mt-3 border border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-700 dark:text-gray-300 flex items-center">
            <span className="text-gray-400 dark:text-gray-500 mr-2">💡</span>
            After saving, use "Test" to verify your webhook configuration.
          </p>
        </div>
      </div>
    </div>
  )
}
