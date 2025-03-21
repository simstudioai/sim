import { Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface GithubConfigProps {
  contentType: string
  setContentType: (contentType: string) => void
  isLoadingToken: boolean
  testResult: {
    success: boolean
    message?: string
    test?: any
  } | null
  copied: string | null
  copyToClipboard: (text: string, type: string) => void
}

export function GithubConfig({
  contentType,
  setContentType,
  isLoadingToken,
  testResult,
}: GithubConfigProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="github-content-type">Content Type</Label>
        {isLoadingToken ? (
          <div className="h-10 px-3 py-2 rounded-md border border-input bg-background flex items-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Input
            id="github-content-type"
            value={contentType}
            onChange={(e) => setContentType(e.target.value)}
            placeholder="application/json"
            className="flex-1"
          />
        )}
      </div>

      <div className="space-y-2">
        <h4 className="font-medium">Setup Instructions</h4>
        <ol className="list-decimal list-inside space-y-1 text-sm">
          <li>Go to your GitHub repository</li>
          <li>Navigate to Settings {'>'} Webhooks</li>
          <li>Click "Add webhook"</li>
          <li>Enter the Webhook URL shown above</li>
          <li>Set Content type to "{contentType}"</li>
          <li>Choose which events you want to trigger the webhook</li>
          <li>Ensure "Active" is checked and save</li>
        </ol>
      </div>

      <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-md mt-3 border border-gray-200 dark:border-gray-700">
        <p className="text-sm text-gray-700 dark:text-gray-300 flex items-center">
          <span className="text-gray-400 dark:text-gray-500 mr-2">💡</span>
          After saving, GitHub will send a ping event to verify your webhook.
        </p>
      </div>
    </div>
  )
}
