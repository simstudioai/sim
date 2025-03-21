import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CopyableField } from '../ui/copyable'
import { TestResultDisplay } from '../ui/test-result'

interface GenericConfigProps {
  requireAuth: boolean
  setRequireAuth: (requireAuth: boolean) => void
  generalToken: string
  setGeneralToken: (token: string) => void
  secretHeaderName: string
  setSecretHeaderName: (headerName: string) => void
  allowedIps: string
  setAllowedIps: (ips: string) => void
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

export function GenericConfig({
  requireAuth,
  setRequireAuth,
  generalToken,
  setGeneralToken,
  secretHeaderName,
  setSecretHeaderName,
  allowedIps,
  setAllowedIps,
  isLoadingToken,
  testResult,
  copied,
  copyToClipboard,
}: GenericConfigProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-2 mb-3">
        <div className="flex items-center h-3.5 space-x-2">
          <Checkbox
            id="require-auth"
            checked={requireAuth}
            onCheckedChange={(checked) => setRequireAuth(checked as boolean)}
          />
          <Label htmlFor="require-auth" className="text-sm font-medium cursor-pointer">
            Require Authentication
          </Label>
        </div>
      </div>

      {requireAuth && (
        <div className="space-y-4 ml-5 border-l-2 pl-4 border-gray-200 dark:border-gray-700">
          <CopyableField
            id="auth-token"
            label="Authentication Token"
            value={generalToken}
            onChange={setGeneralToken}
            placeholder="Enter an auth token"
            description="This token will be used to authenticate requests to your webhook (via Bearer token)."
            isLoading={isLoadingToken}
            copied={copied}
            copyType="general-token"
            copyToClipboard={copyToClipboard}
          />

          <div className="space-y-2">
            <Label htmlFor="header-name">Secret Header Name (Optional)</Label>
            <Input
              id="header-name"
              value={secretHeaderName}
              onChange={(e) => setSecretHeaderName(e.target.value)}
              placeholder="X-Secret-Key"
              className="flex-1"
            />
            <p className="text-xs text-muted-foreground">
              Custom HTTP header name for passing the authentication token instead of using Bearer
              authentication.
            </p>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="allowed-ips">Allowed IP Addresses (Optional)</Label>
        <Input
          id="allowed-ips"
          value={allowedIps}
          onChange={(e) => setAllowedIps(e.target.value)}
          placeholder="192.168.1.1, 10.0.0.1"
          className="flex-1"
        />
        <p className="text-xs text-muted-foreground">
          Comma-separated list of IP addresses that are allowed to access this webhook.
        </p>
      </div>

      <TestResultDisplay
        testResult={testResult}
        copied={copied}
        copyToClipboard={copyToClipboard}
        showCurlCommand={true}
      />

      <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-md mt-3 border border-gray-200 dark:border-gray-700">
        <h4 className="font-medium text-sm mb-2">Setup Instructions</h4>
        <ol className="list-decimal list-inside space-y-1 text-sm">
          <li>Copy the Webhook URL above</li>
          <li>Configure your service to send HTTP POST requests to this URL</li>
          {requireAuth && (
            <>
              <li>
                {secretHeaderName
                  ? `Add the "${secretHeaderName}" header with your token to all requests`
                  : 'Add an "Authorization: Bearer YOUR_TOKEN" header to all requests'}
              </li>
            </>
          )}
        </ol>

        <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-700 dark:text-gray-300 flex items-center">
            <span className="text-gray-400 dark:text-gray-500 mr-2">💡</span>
            The webhook will receive all HTTP POST requests and pass the data to your workflow.
          </p>
        </div>
      </div>
    </div>
  )
}
