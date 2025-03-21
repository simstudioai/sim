import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CopyableField } from '../ui/copyable'
import { TestResultDisplay } from '../ui/test-result'

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

export function DiscordConfig({
  webhookName,
  setWebhookName,
  avatarUrl,
  setAvatarUrl,
  isLoadingToken,
  testResult,
  copied,
  copyToClipboard,
  testWebhook,
}: DiscordConfigProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="discord-webhook-name">Webhook Name (Optional)</Label>
        <Input
          id="discord-webhook-name"
          value={webhookName}
          onChange={(e) => setWebhookName(e.target.value)}
          placeholder="Enter a name for your webhook"
          disabled={isLoadingToken}
        />
        <p className="text-xs text-muted-foreground">
          This name will be displayed as the sender of messages in Discord.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="discord-avatar-url">Avatar URL (Optional)</Label>
        <Input
          id="discord-avatar-url"
          value={avatarUrl}
          onChange={(e) => setAvatarUrl(e.target.value)}
          placeholder="https://example.com/avatar.png"
          disabled={isLoadingToken}
        />
        <p className="text-xs text-muted-foreground">
          URL to an image that will be used as the webhook's avatar.
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
          <li>Open Discord and go to the server where you want to add the webhook</li>
          <li>Click the gear icon next to a channel to open Channel Settings</li>
          <li>Navigate to "Integrations" {'>'} "Webhooks"</li>
          <li>Click "New Webhook"</li>
          <li>Give your webhook a name and choose an avatar (optional)</li>
          <li>Select the channel the webhook will post to</li>
          <li>Click "Copy Webhook URL" and save it for your records</li>
          <li>Click "Save"</li>
          <li>Use the Webhook URL above to receive messages from Discord</li>
        </ol>
      </div>

      <div className="bg-indigo-50 dark:bg-indigo-950 p-3 rounded-md mt-3 border border-indigo-200 dark:border-indigo-800">
        <h5 className="text-sm font-medium text-indigo-800 dark:text-indigo-300">
          Discord Webhook Features
        </h5>
        <ul className="mt-1 space-y-1">
          <li className="flex items-start">
            <span className="text-indigo-500 dark:text-indigo-400 mr-2">•</span>
            <span className="text-sm text-indigo-700 dark:text-indigo-300">
              Customize message appearance with embeds and formatting
            </span>
          </li>
          <li className="flex items-start">
            <span className="text-indigo-500 dark:text-indigo-400 mr-2">•</span>
            <span className="text-sm text-indigo-700 dark:text-indigo-300">
              Send messages with different usernames and avatars per request
            </span>
          </li>
          <li className="flex items-start">
            <span className="text-indigo-500 dark:text-indigo-400 mr-2">•</span>
            <span className="text-sm text-indigo-700 dark:text-indigo-300">
              Discord secures webhooks by keeping URLs private - protect your webhook URL
            </span>
          </li>
        </ul>
      </div>

      <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-md mt-3 border border-gray-200 dark:border-gray-700">
        <p className="text-sm text-gray-700 dark:text-gray-300 flex items-center">
          <span className="text-gray-400 dark:text-gray-500 mr-2">💡</span>
          You can use this webhook to receive notifications from Discord or to send messages to your
          Discord channel.
        </p>
      </div>

      <div className="bg-purple-50 dark:bg-purple-950 p-3 rounded-md mt-3 border border-purple-200 dark:border-purple-800">
        <h5 className="text-sm font-medium text-purple-800 dark:text-purple-300">
          Example POST Request
        </h5>
        <pre className="mt-2 text-xs bg-black/5 dark:bg-white/5 p-2 rounded overflow-x-auto">
          {`POST /api/webhooks/{your-webhook-id} HTTP/1.1
Content-Type: application/json

{
  "content": "Hello from Sim Studio!",
  "username": "Custom Bot Name",
  "avatar_url": "https://example.com/avatar.png"
}`}
        </pre>
      </div>
    </div>
  )
}
