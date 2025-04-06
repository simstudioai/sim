import { SlackIcon } from '@/components/icons'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { CodeBlock } from '@/components/ui/code-block'
import { ConfigField } from '../ui/config-field'
import { ConfigSection } from '../ui/config-section'
import { CopyableField } from '../ui/copyable'
import { InstructionsSection } from '../ui/instructions-section'
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

const exampleEvent = JSON.stringify(
  {
    type: 'event_callback',
    event: {
      type: 'message',
      channel: 'C0123456789',
      user: 'U0123456789',
      text: 'Hello from Slack!',
      ts: '1234567890.123456',
    },
    team_id: 'T0123456789',
    event_id: 'Ev0123456789',
    event_time: 1234567890,
  },
  null,
  2
)

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
      <ConfigSection title="Slack Configuration">
        <ConfigField
          id="slack-signing-secret"
          label="Signing Secret"
          description="Found on your Slack app's Basic Information page. Used to validate requests."
        >
          <CopyableField
            id="slack-signing-secret"
            value={signingSecret}
            onChange={setSigningSecret}
            placeholder="Enter your Slack app signing secret"
            isLoading={isLoadingToken}
            copied={copied}
            copyType="slack-signing-secret"
            copyToClipboard={copyToClipboard}
            readOnly={false}
            isSecret
          />
        </ConfigField>
      </ConfigSection>

      <TestResultDisplay
        testResult={testResult}
        copied={copied}
        copyToClipboard={copyToClipboard}
        showCurlCommand={true}
      />

      <InstructionsSection tip="Slack will verify the Request URL before enabling events.">
        <ol className="list-decimal list-inside space-y-1">
          <li>
            Go to your{' '}
            <a
              href="https://api.slack.com/apps"
              target="_blank"
              rel="noopener noreferrer"
              className="link"
            >
              Slack Apps page
            </a>
            .
          </li>
          <li>Select your app or create a new one.</li>
          <li>Navigate to "Event Subscriptions" and enable events.</li>
          <li>
            Paste the <strong>Webhook URL</strong> (from above) into the "Request URL" field.
          </li>
          <li>Subscribe to the workspace events you need (e.g., `message.channels`).</li>
          <li>Go to "Basic Information", find the "Signing Secret", and copy it.</li>
          <li>Paste the Signing Secret into the field above.</li>
          <li>Save changes in both Slack and here.</li>
        </ol>
      </InstructionsSection>

      <Alert>
        <SlackIcon className="h-4 w-4" />
        <AlertTitle>Slack Event Payload Example</AlertTitle>
        <AlertDescription>
          Your workflow will receive a payload similar to this when a subscribed event occurs:
          <CodeBlock language="json" code={exampleEvent} className="mt-2 text-sm" />
        </AlertDescription>
      </Alert>
    </div>
  )
}
