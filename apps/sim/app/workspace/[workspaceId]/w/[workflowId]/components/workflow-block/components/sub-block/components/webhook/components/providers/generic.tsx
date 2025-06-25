import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ConfigField } from '../ui/config-field'
import { ConfigSection } from '../ui/config-section'
import { CopyableField } from '../ui/copyable'
import { InstructionsSection } from '../ui/instructions-section'
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
    <div className='space-y-4'>
      <ConfigSection title='Authentication'>
        <div className='flex items-center space-x-2'>
          <Checkbox
            id='require-auth'
            checked={requireAuth}
            onCheckedChange={(checked) => setRequireAuth(checked as boolean)}
            className='translate-y-[1px]' // Align checkbox better with label
          />
          <Label htmlFor='require-auth' className='cursor-pointer font-medium text-sm'>
            Require Authentication
          </Label>
        </div>

        {requireAuth && (
          <div className='ml-5 space-y-4 border-border border-l-2 pl-4 dark:border-border/50'>
            <ConfigField id='auth-token' label='Authentication Token'>
              <CopyableField
                id='auth-token'
                value={generalToken}
                onChange={setGeneralToken}
                placeholder='Enter an auth token'
                description='Used to authenticate requests via Bearer token or custom header.'
                isLoading={isLoadingToken}
                copied={copied}
                copyType='general-token'
                copyToClipboard={copyToClipboard}
              />
            </ConfigField>

            <ConfigField
              id='header-name'
              label='Secret Header Name (Optional)'
              description="Custom HTTP header name for the auth token (e.g., X-Secret-Key). If blank, use 'Authorization: Bearer TOKEN'."
            >
              <Input
                id='header-name'
                value={secretHeaderName}
                onChange={(e) => setSecretHeaderName(e.target.value)}
                placeholder='X-Secret-Key'
              />
            </ConfigField>
          </div>
        )}
      </ConfigSection>

      <ConfigSection title='Network'>
        <ConfigField
          id='allowed-ips'
          label='Allowed IP Addresses (Optional)'
          description='Comma-separated list of IP addresses allowed to access this webhook.'
        >
          <Input
            id='allowed-ips'
            value={allowedIps}
            onChange={(e) => setAllowedIps(e.target.value)}
            placeholder='192.168.1.1, 10.0.0.1'
          />
        </ConfigField>
      </ConfigSection>

      <TestResultDisplay
        testResult={testResult}
        copied={copied}
        copyToClipboard={copyToClipboard}
        showCurlCommand={true}
      />

      <InstructionsSection tip='The webhook receives HTTP POST requests and passes the data to your workflow.'>
        <ol className='list-inside list-decimal space-y-1'>
          <li>Copy the Webhook URL provided above.</li>
          <li>Configure your external service to send HTTP POST requests to this URL.</li>
          {requireAuth && (
            <li>
              Include your authentication token in requests using either the
              {secretHeaderName
                ? ` "${secretHeaderName}" header`
                : ' "Authorization: Bearer YOUR_TOKEN" header'}
              .
            </li>
          )}
        </ol>
      </InstructionsSection>
    </div>
  )
}
