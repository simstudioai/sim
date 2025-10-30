import { Shield, Terminal } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle, CodeBlock, Input } from '@/components/ui'
import {
  ConfigField,
  ConfigSection,
  InstructionsSection,
  TestResultDisplay,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/webhook/components'

interface MicrosoftTeamsConfigProps {
  hmacSecret: string
  setHmacSecret: (secret: string) => void
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

const teamsWebhookExample = JSON.stringify(
  {
    type: 'message',
    id: '1234567890',
    timestamp: '2023-01-01T00:00:00.000Z',
    localTimestamp: '2023-01-01T00:00:00.000Z',
    serviceUrl: 'https://smba.trafficmanager.net/amer/',
    channelId: 'msteams',
    from: {
      id: '29:1234567890abcdef',
      name: 'John Doe',
    },
    conversation: {
      id: '19:meeting_abcdef@thread.v2',
    },
    text: 'Hello Sim Bot!',
  },
  null,
  2
)

export function MicrosoftTeamsConfig({
  hmacSecret,
  setHmacSecret,
  isLoadingToken,
  testResult,
  copied,
  copyToClipboard,
  testWebhook,
}: MicrosoftTeamsConfigProps) {
  return (
    <div className='space-y-4'>
      <ConfigSection title='Microsoft Teams Configuration'>
        <ConfigField
          id='teams-hmac-secret'
          label='HMAC Secret'
          description='The security token provided by Teams when creating an outgoing webhook. Used to verify request authenticity.'
        >
          <Input
            id='teams-hmac-secret'
            value={hmacSecret}
            onChange={(e) => setHmacSecret(e.target.value)}
            placeholder='Enter HMAC secret from Teams'
            disabled={isLoadingToken}
            type='password'
          />
        </ConfigField>
      </ConfigSection>

      <TestResultDisplay
        testResult={testResult}
        copied={copied}
        copyToClipboard={copyToClipboard}
        showCurlCommand={true}
      />

      <InstructionsSection
        title='Setting up Outgoing Webhook in Microsoft Teams'
        tip='Create an outgoing webhook in Teams to receive messages from Teams in Sim.'
      >
        <ol className='list-inside list-decimal space-y-1'>
          <li>Open Microsoft Teams and go to the team where you want to add the webhook.</li>
          <li>Click the three dots (•••) next to the team name and select "Manage team".</li>
          <li>Go to the "Apps" tab and click "Create an outgoing webhook".</li>
          <li>Provide a name, description, and optionally a profile picture.</li>
          <li>Set the callback URL to your Sim webhook URL (shown above).</li>
          <li>Copy the HMAC security token and paste it into the "HMAC Secret" field above.</li>
          <li>Click "Create" to finish setup.</li>
        </ol>
      </InstructionsSection>

      <InstructionsSection title='Receiving Messages from Teams'>
        <p>
          When users mention your webhook in Teams (using @mention), Teams will send a POST request
          to your Sim webhook URL with a payload like this:
        </p>
        <CodeBlock language='json' code={teamsWebhookExample} className='mt-2 text-sm' />
        <ul className='mt-3 list-outside list-disc space-y-1 pl-4'>
          <li>Messages are triggered by @mentioning the webhook name in Teams.</li>
          <li>Requests include HMAC signature for authentication.</li>
          <li>You have 5 seconds to respond to the webhook request.</li>
        </ul>
      </InstructionsSection>

      <Alert>
        <Shield className='h-4 w-4' />
        <AlertTitle>Security</AlertTitle>
        <AlertDescription>
          The HMAC secret is used to verify that requests are actually coming from Microsoft Teams.
          Keep it secure and never share it publicly.
        </AlertDescription>
      </Alert>

      <Alert>
        <Terminal className='h-4 w-4' />
        <AlertTitle>Requirements</AlertTitle>
        <AlertDescription>
          <ul className='mt-1 list-outside list-disc space-y-1 pl-4'>
            <li>Your Sim webhook URL must use HTTPS and be publicly accessible.</li>
            <li>Self-signed SSL certificates are not supported by Microsoft Teams.</li>
            <li>For local testing, use a tunneling service like ngrok or Cloudflare Tunnel.</li>
          </ul>
        </AlertDescription>
      </Alert>
    </div>
  )
}
