import { Terminal } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle, CodeBlock, Input } from '@/components/ui'
import {
  ConfigField,
  ConfigSection,
  InstructionsSection,
  TestResultDisplay,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/components/webhook/components'

interface DiscordConfigProps {
  webhookName: string
  setWebhookName: (name: string) => void
  avatarUrl: string
  setAvatarUrl: (url: string) => void
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

const examplePayload = JSON.stringify(
  {
    content: 'Hello from Sim Studio!',
    username: 'Optional Custom Name',
    avatar_url: 'https://example.com/avatar.png',
  },
  null,
  2
)

export function DiscordConfig({
  webhookName,
  setWebhookName,
  avatarUrl,
  setAvatarUrl,
  isLoadingToken,
  testResult,
  copied,
  copyToClipboard,
  testWebhook, // Passed to TestResultDisplay
}: DiscordConfigProps) {
  return (
    <div className='space-y-4'>
      <ConfigSection title='Discord Appearance (Optional)'>
        <ConfigField
          id='discord-webhook-name'
          label='Webhook Name'
          description='This name will be displayed as the sender of messages in Discord.'
        >
          <Input
            id='discord-webhook-name'
            value={webhookName}
            onChange={(e) => setWebhookName(e.target.value)}
            placeholder='Sim Studio Bot'
            disabled={isLoadingToken}
          />
        </ConfigField>

        <ConfigField
          id='discord-avatar-url'
          label='Avatar URL'
          description="URL to an image that will be used as the webhook's avatar."
        >
          <Input
            id='discord-avatar-url'
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            placeholder='https://example.com/avatar.png'
            disabled={isLoadingToken}
            type='url'
          />
        </ConfigField>
      </ConfigSection>

      <TestResultDisplay
        testResult={testResult}
        copied={copied}
        copyToClipboard={copyToClipboard}
        showCurlCommand={true} // Discord can be tested via curl
      />

      <InstructionsSection
        title='Receiving Events from Discord (Incoming Webhook)'
        tip='Create a webhook in Discord and paste its URL into the Webhook URL field above.'
      >
        <ol className='list-inside list-decimal space-y-1'>
          <li>Go to Discord Server Settings {'>'} Integrations.</li>
          <li>Click "Webhooks" then "New Webhook".</li>
          <li>Customize the name and channel.</li>
          <li>Click "Copy Webhook URL".</li>
          <li>
            Paste the copied Discord URL into the main <strong>Webhook URL</strong> field above.
          </li>
          <li>Your workflow triggers when Discord sends an event to that URL.</li>
        </ol>
      </InstructionsSection>

      <InstructionsSection title='Sending Messages to Discord (Outgoing via this URL)'>
        <p>
          To send messages <i>to</i> Discord using the Sim Studio Webhook URL (above), make a POST
          request with a JSON body like this:
        </p>
        <CodeBlock language='json' code={examplePayload} className='mt-2 text-sm' />
        <ul className='mt-3 list-outside list-disc space-y-1 pl-4'>
          <li>Customize message appearance with embeds (see Discord docs).</li>
          <li>Override the default username/avatar per request if needed.</li>
        </ul>
      </InstructionsSection>

      <Alert>
        <Terminal className='h-4 w-4' />
        <AlertTitle>Security Note</AlertTitle>
        <AlertDescription>
          The Sim Studio Webhook URL allows sending messages <i>to</i> Discord. Treat it like a
          password. Don't share it publicly.
        </AlertDescription>
      </Alert>
    </div>
  )
}
