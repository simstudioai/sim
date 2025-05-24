import { SlackIcon } from '@/components/icons'
import { Notice } from '@/components/ui/notice'
import { JSONView } from '@/app/w/[id]/components/panel/components/console/components/json-view/json-view'
import { ConfigSection } from '../ui/config-section'
import { InstructionsSection } from '../ui/instructions-section'
import { TestResultDisplay } from '../ui/test-result'
import { WebhookConfigField } from '../ui/webhook-config-field'

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
  webhookUrl: string
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
  webhookUrl,
}: SlackConfigProps) {
  return (
    <div className="space-y-4">
      <ConfigSection title="Slack Configuration">
        <WebhookConfigField
          id="webhook-url"
          label="Webhook URL"
          value={webhookUrl}
          description="This is the URL that will receive webhook requests"
          isLoading={isLoadingToken}
          copied={copied}
          copyType="url"
          copyToClipboard={copyToClipboard}
          readOnly={true}
        />

        <WebhookConfigField
          id="slack-signing-secret"
          label="Signing Secret"
          value={signingSecret}
          onChange={setSigningSecret}
          placeholder="Enter your Slack app signing secret"
          description="Found on your Slack app's Basic Information page. Used to validate requests."
          isLoading={isLoadingToken}
          copied={copied}
          copyType="slack-signing-secret"
          copyToClipboard={copyToClipboard}
          isSecret={true}
        />
      </ConfigSection>

      <TestResultDisplay
        testResult={testResult}
        copied={copied}
        copyToClipboard={copyToClipboard}
        showCurlCommand={true}
      />

      <InstructionsSection>
        <ol className="list-decimal list-inside space-y-2">
          <li>
            Go to{' '}
            <a
              href="https://api.slack.com/apps"
              target="_blank"
              rel="noopener noreferrer"
              className="link text-primary underline hover:text-primary/80 transition-colors"
              onClick={(e) => {
                e.stopPropagation()
                window.open('https://api.slack.com/apps', '_blank', 'noopener,noreferrer')
                e.preventDefault()
              }}
            >
              Slack Apps page
            </a>
          </li>
          <li>
            If you don't have an app:
            <ol className="list-disc ml-5 mt-1">
              <li>Create an app from scratch</li>
              <li>Give it a name and select your workspace</li>
            </ol>
          </li>
          <li>
            Go to "Basic Information", find the "Signing Secret", and paste it in the field above.
          </li>
          <li>
            Go to "OAuth & Permissions" and add bot token scopes:
            <ol className="list-disc ml-5 mt-1">
              <li>
                <code>app_mentions:read</code> - For viewing messages that tag your bot with an @
              </li>
              <li>
                <code>chat:write</code> - To send messages to channels your bot is a part of
              </li>
            </ol>
          </li>
          <li>
            Go to "Event Subscriptions":
            <ol className="list-disc ml-5 mt-1">
              <li>Enable events</li>
              <li>
                Under "Subscribe to Bot Events", add <code>app_mention</code> to listen to messages
                that mention your bot
              </li>
              <li>Paste the Webhook URL (from above) into the "Request URL" field</li>
            </ol>
          </li>
          <li>Save changes in both Slack and here.</li>
        </ol>
      </InstructionsSection>

      <Notice
        variant="default"
        className="bg-white border-slate-200 dark:bg-background dark:border-border"
        icon={
          <SlackIcon className="h-5 w-5 text-[#611f69] dark:text-[#e01e5a] mt-0.5 mr-3.5 flex-shrink-0" />
        }
        title="Slack Event Payload Example"
      >
        Your workflow will receive a payload similar to this when a subscribed event occurs:
        <div className="mt-2 text-sm font-mono break-normal whitespace-normal overflow-wrap-anywhere">
          <JSONView data={JSON.parse(exampleEvent)} />
        </div>
      </Notice>
    </div>
  )
}
