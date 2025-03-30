import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CopyableField } from '../ui/copyable'
import { TestResultDisplay } from '../ui/test-result'

interface GithubConfigProps {
  contentType: string
  setContentType: (contentType: string) => void
  webhookSecret: string
  setWebhookSecret: (secret: string) => void
  sslVerification: string
  setSslVerification: (value: string) => void
  isLoadingToken: boolean
  testResult: {
    success: boolean
    message?: string
    test?: any
  } | null
  copied: string | null
  copyToClipboard: (text: string, type: string) => void
  testWebhook: () => Promise<void>
}

export function GithubConfig({
  contentType,
  setContentType,
  webhookSecret,
  setWebhookSecret,
  sslVerification,
  setSslVerification,
  isLoadingToken,
  testResult,
  copied,
  copyToClipboard,
}: GithubConfigProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="github-content-type">Content Type</Label>
        <Select value={contentType} onValueChange={setContentType}>
          <SelectTrigger id="github-content-type">
            <SelectValue placeholder="Select content type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="application/json">application/json</SelectItem>
            <SelectItem value="application/x-www-form-urlencoded">
              application/x-www-form-urlencoded
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Format GitHub will use when sending the webhook payload.
        </p>
      </div>

      <CopyableField
        id="webhook-secret"
        label="Webhook Secret (Optional but Recommended)"
        value={webhookSecret}
        onChange={setWebhookSecret}
        placeholder="Enter a secret for GitHub webhook"
        description="A secret token to validate that webhook deliveries are coming from GitHub."
        isLoading={isLoadingToken}
        copied={copied}
        copyType="github-secret"
        copyToClipboard={copyToClipboard}
      />

      <div className="space-y-2">
        <Label htmlFor="github-ssl-verification">SSL Verification</Label>
        <Select value={sslVerification} onValueChange={setSslVerification}>
          <SelectTrigger id="github-ssl-verification">
            <SelectValue placeholder="Select SSL verification option" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="enabled">Enabled (Recommended)</SelectItem>
            <SelectItem value="disabled">Disabled (Not recommended)</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          GitHub will verify SSL certificates when delivering webhooks.
        </p>
      </div>

      <TestResultDisplay
        testResult={testResult}
        copied={copied}
        copyToClipboard={copyToClipboard}
        showCurlCommand={true}
      />

      <div className="space-y-2">
        <h4 className="font-medium">Setup Instructions</h4>
        <ol className="list-decimal list-inside space-y-1 text-sm">
          <li>Go to your GitHub repository</li>
          <li>Navigate to Settings {'>'} Webhooks</li>
          <li>Click "Add webhook"</li>
          <li>Enter the Webhook URL shown above as the "Payload URL"</li>
          <li>Set Content type to "{contentType}"</li>
          {webhookSecret && (
            <li>Enter the same secret shown above in the "Secret" field for validation</li>
          )}
          <li>Choose SSL verification</li>
          <li>
            Choose which events trigger the webhook (e.g., "Just the push event" or "Send me
            everything")
          </li>
          <li>Ensure "Active" is checked and click "Add webhook"</li>
        </ol>
      </div>

      <div className="bg-blue-50 dark:bg-blue-950 p-3 rounded-md mt-3 border border-blue-200 dark:border-blue-800">
        <h5 className="text-sm font-medium text-blue-800 dark:text-blue-300">
          Security Best Practices
        </h5>
        <ul className="mt-1 space-y-1">
          <li className="flex items-start">
            <span className="text-blue-500 dark:text-blue-400 mr-2">•</span>
            <span className="text-sm text-blue-700 dark:text-blue-300">
              Always use a secret token to validate requests from GitHub
            </span>
          </li>
          <li className="flex items-start">
            <span className="text-blue-500 dark:text-blue-400 mr-2">•</span>
            <span className="text-sm text-blue-700 dark:text-blue-300">
              Keep SSL verification enabled unless you have a specific reason to disable it
            </span>
          </li>
        </ul>
      </div>

      <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-md mt-3 border border-gray-200 dark:border-gray-700">
        <p className="text-sm text-gray-700 dark:text-gray-300 flex items-center">
          <span className="text-gray-400 dark:text-gray-500 mr-2">💡</span>
          After saving, GitHub will send a ping event to verify your webhook. You can view delivery
          details and redeliver events from the webhook settings.
        </p>
      </div>
    </div>
  )
}
