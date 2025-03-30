import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CopyableField } from '../ui/copyable'
import { TestResultDisplay } from '../ui/test-result'

interface SlackConfigProps {
  signingSecret: string
  setSigningSecret: (secret: string) => void
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

export function SlackConfig({
  signingSecret,
  setSigningSecret,
  isLoadingToken,
  testResult,
  copied,
  copyToClipboard,
}: SlackConfigProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <CopyableField
          id="slack-signing-secret"
          label="Signing Secret"
          value={signingSecret}
          onChange={setSigningSecret}
          placeholder="Enter your Slack app signing secret"
          description="The signing secret from your Slack app used to validate request authenticity."
          isLoading={isLoadingToken}
          copied={copied}
          copyType="slack-signing-secret"
          copyToClipboard={copyToClipboard}
        />
        <p className="text-xs text-muted-foreground">
          The signing secret is provided in your Slack app&apos;s Basic Information page.
        </p>
      </div>

      <TestResultDisplay
        testResult={testResult}
        copied={copied}
        copyToClipboard={copyToClipboard}
        showCurlCommand={true}
      />

      <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-md mt-3 border border-gray-200 dark:border-gray-700">
        <h4 className="font-medium">Setup Instructions</h4>
        <ol className="list-decimal list-inside space-y-1 text-sm">
          <li>
            Go to your{' '}
            <a
              href="https://api.slack.com/apps"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:underline"
            >
              Slack Apps page
            </a>
          </li>
          <li>Create a new app or select an existing one</li>
          <li>Navigate to &quot;Event Subscriptions&quot; in the left sidebar</li>
          <li>Enable events and add the Webhook URL above as the Request URL</li>
          <li>Add the event subscriptions you want to receive (e.g., message.channels)</li>
          <li>Go to &quot;Basic Information&quot; and copy your Signing Secret</li>
          <li>Paste the Signing Secret in the field above</li>
          <li>Save your configuration</li>
        </ol>
      </div>

      <div className="bg-emerald-50 dark:bg-emerald-950 p-3 rounded-md mt-3 border border-emerald-200 dark:border-emerald-800">
        <h5 className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
          Slack Webhook Features
        </h5>
        <ul className="mt-1 space-y-1">
          <li className="flex items-start">
            <span className="text-emerald-500 dark:text-emerald-400 mr-2">•</span>
            <span className="text-sm text-emerald-700 dark:text-emerald-300">
              Receive events from Slack channels, direct messages, and more
            </span>
          </li>
          <li className="flex items-start">
            <span className="text-emerald-500 dark:text-emerald-400 mr-2">•</span>
            <span className="text-sm text-emerald-700 dark:text-emerald-300">
              Trigger workflows based on messages, reactions, or other Slack events
            </span>
          </li>
          <li className="flex items-start">
            <span className="text-emerald-500 dark:text-emerald-400 mr-2">•</span>
            <span className="text-sm text-emerald-700 dark:text-emerald-300">
              Securely verify incoming requests with Slack&apos;s signing secret
            </span>
          </li>
        </ul>
      </div>

      <div className="bg-purple-50 dark:bg-purple-950 p-3 rounded-md mt-3 border border-purple-200 dark:border-purple-800">
        <h5 className="text-sm font-medium text-purple-800 dark:text-purple-300">
          Example Slack Event
        </h5>
        <pre className="mt-2 text-xs bg-black/5 dark:bg-white/5 p-2 rounded overflow-x-auto">
          {`{
  "type": "event_callback",
  "event": {
    "type": "message",
    "channel": "C0123456789",
    "user": "U0123456789",
    "text": "Hello from Slack!",
    "ts": "1234567890.123456"
  },
  "team_id": "T0123456789",
  "event_id": "Ev0123456789",
  "event_time": 1234567890
}`}
        </pre>
      </div>
    </div>
  )
}
