import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { TestResultDisplay } from '../ui/test-result'

interface TwilioConfigProps {
  sendReply: boolean
  setSendReply: (send: boolean) => void
  testResult: {
    success: boolean
    message?: string
    test?: any
  } | null
  copied: string | null
  copyToClipboard: (text: string, type: string) => void
}

export function TwilioConfig({
  sendReply,
  setSendReply,
  testResult,
  copied,
  copyToClipboard,
}: TwilioConfigProps) {
  return (
    <div className="space-y-4">

      <div className="flex items-center space-x-2 mt-4">
        <Checkbox
          id="send-reply"
          checked={sendReply}
          onCheckedChange={(checked) => setSendReply(checked as boolean)}
        />
        <Label htmlFor="send-reply" className="text-sm font-medium cursor-pointer">
          Send automatic reply messages
        </Label>
      </div>
      <p className="text-xs text-muted-foreground ml-6">
        When enabled, your workflow can generate responses to incoming messages.
      </p>

      {testResult && (
        <TestResultDisplay
          testResult={testResult}
          copied={copied}
          copyToClipboard={copyToClipboard}
          showCurlCommand={true}
        />
      )}

      <div className="space-y-2">
        <h4 className="font-medium">Setup Instructions</h4>
        <ol className="list-decimal list-inside space-y-1 text-sm">
          <li>Log in to your Twilio account dashboard</li>
          <li>Navigate to your phone number configuration</li>
          <li>Find the messaging settings section</li>
          <li>Set the webhook URL for when "A message comes in"</li>
          <li>Paste the Webhook URL above as the callback URL</li>
          <li>Select HTTP POST as the request method</li>
          <li>Save your configuration changes</li>
        </ol>
      </div>

      <div className="bg-purple-50 dark:bg-purple-950 p-3 rounded-md mt-3 border border-purple-200 dark:border-purple-800">
        <h5 className="text-sm font-medium text-purple-800 dark:text-purple-300">
          Twilio Webhook Security
        </h5>
        <ul className="mt-1 space-y-1">
          <li className="flex items-start">
            <span className="text-purple-500 dark:text-purple-400 mr-2">•</span>
            <span className="text-sm text-purple-700 dark:text-purple-300">
              Always validate incoming requests using your Auth Token
            </span>
          </li>
          <li className="flex items-start">
            <span className="text-purple-500 dark:text-purple-400 mr-2">•</span>
            <span className="text-sm text-purple-700 dark:text-purple-300">
              Twilio adds a validation signature to every webhook request
            </span>
          </li>
          <li className="flex items-start">
            <span className="text-purple-500 dark:text-purple-400 mr-2">•</span>
            <span className="text-sm text-purple-700 dark:text-purple-300">
              Your webhook must be publicly accessible with a valid SSL certificate
            </span>
          </li>
        </ul>
      </div>

      <div className="bg-amber-50 dark:bg-amber-950 p-3 rounded-md mt-3 border border-amber-200 dark:border-amber-800">
        <h5 className="text-sm font-medium text-amber-800 dark:text-amber-300">
          Local Development Tips
        </h5>
        <ul className="mt-1 space-y-1">
          <li className="flex items-start">
            <span className="text-amber-500 dark:text-amber-400 mr-2">•</span>
            <span className="text-sm text-amber-700 dark:text-amber-300">
              For local testing, use ngrok to expose your local server: <code>ngrok http 3000</code>
            </span>
          </li>
          <li className="flex items-start">
            <span className="text-amber-500 dark:text-amber-400 mr-2">•</span>
            <span className="text-sm text-amber-700 dark:text-amber-300">
              Update your Twilio webhook URL with the ngrok-generated HTTPS URL
            </span>
          </li>
          <li className="flex items-start">
            <span className="text-amber-500 dark:text-amber-400 mr-2">•</span>
            <span className="text-sm text-amber-700 dark:text-amber-300">
              Remember that ngrok URLs change each time you restart ngrok (unless using a paid plan)
            </span>
          </li>
        </ul>
      </div>

      <div className="bg-blue-50 dark:bg-blue-950 p-3 rounded-md mt-3 border border-blue-200 dark:border-blue-800">
        <h5 className="text-sm font-medium text-blue-800 dark:text-blue-300">
          TwiML Response Details
        </h5>
        <p className="mt-1 text-sm text-blue-700 dark:text-blue-300">
          {sendReply
            ? 'Your workflow can return TwiML to respond to incoming messages. The webhook will send a <Message> response with your workflow output.'
            : 'You have disabled automatic replies. The webhook will return an empty <Response> TwiML.'}
        </p>
        <pre className="mt-2 text-xs bg-black/5 dark:bg-white/5 p-2 rounded overflow-x-auto">
          {sendReply
            ? `<Response>
  <Message>Your reply message here</Message>
</Response>`
            : `<Response></Response>`}
        </pre>
      </div>

      <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-md mt-3 border border-gray-200 dark:border-gray-700">
        <p className="text-sm text-gray-700 dark:text-gray-300 flex items-center">
          <span className="text-gray-400 dark:text-gray-500 mr-2">💡</span>
          For more advanced features, you can use Media in your responses, or implement complex messaging workflows.
        </p>
      </div>
    </div>
  )
} 