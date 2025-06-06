import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertCircle, CheckCircle, Loader2, XCircle, Info } from 'lucide-react'
import { ConfigField } from '../ui/config-field'
import { ConfigSection } from '../ui/config-section'
import { InstructionsSection } from '../ui/instructions-section'
import { TestResultDisplay as WebhookTestResult } from '../ui/test-result'

interface TelegramConfigProps {
  botToken: string
  setBotToken: (value: string) => void
  isLoadingToken: boolean
  testResult: any
  copied: string | null
  copyToClipboard: (text: string, type: string) => void
  testWebhook?: () => void // Optional test function
  webhookId?: string // Webhook ID to enable testing
  webhookUrl: string // Added webhook URL
  diagnostics?: any // Diagnostic results
  isRunningDiagnostics?: boolean // Loading state for diagnostics
  runDiagnostics?: () => void // Function to run diagnostics
}

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'success':
      return <CheckCircle className='h-4 w-4 text-green-500' />
    case 'error':
      return <XCircle className='h-4 w-4 text-red-500' />
    case 'warning':
      return <AlertCircle className='h-4 w-4 text-yellow-500' />
    case 'info':
      return <Info className='h-4 w-4 text-blue-500' />
    default:
      return <Info className='h-4 w-4 text-gray-500' />
  }
}

export function TelegramConfig({
  botToken,
  setBotToken,
  isLoadingToken,
  testResult,
  copied,
  copyToClipboard,
  testWebhook,
  webhookId,
  webhookUrl,
  diagnostics,
  isRunningDiagnostics = false,
  runDiagnostics,
}: TelegramConfigProps) {
  return (
    <div className='space-y-4'>
      <ConfigSection title='Telegram Configuration'>
        <ConfigField
          id='telegram-bot-token'
          label='Bot Token *'
          description='Your Telegram Bot Token from BotFather'
        >
          {isLoadingToken ? (
            <Skeleton className='h-10 w-full' />
          ) : (
            <Input
              id='telegram-bot-token'
              value={botToken}
              onChange={(e) => {
                setBotToken(e.target.value)
              }}
              placeholder='123456789:ABCdefGHIjklMNOpqrsTUVwxyz'
              type='password'
              required
            />
          )}
        </ConfigField>
      </ConfigSection>

      {testResult && (
        <WebhookTestResult
          testResult={testResult}
          copied={copied}
          copyToClipboard={copyToClipboard}
        />
      )}

      {/* Diagnostic Section */}
      {webhookId && runDiagnostics && (
        <ConfigSection title='Troubleshooting'>
          <div className='space-y-3'>
            <div className='flex items-center justify-between'>
              <p className='text-sm text-gray-600'>
                Having issues? Run diagnostics to check your Telegram webhook configuration.
              </p>
              <Button
                variant='outline'
                size='sm'
                onClick={runDiagnostics}
                disabled={isRunningDiagnostics}
                className='shrink-0'
              >
                {isRunningDiagnostics ? (
                  <>
                    <Loader2 className='h-4 w-4 mr-2 animate-spin' />
                    Running...
                  </>
                ) : (
                  'Diagnose Issues'
                )}
              </Button>
            </div>

            {diagnostics && (
              <div className='space-y-3'>
                {diagnostics.error ? (
                  <div className='flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-md'>
                    <XCircle className='h-4 w-4 text-red-500 mt-0.5 shrink-0' />
                    <div>
                      <p className='text-sm font-medium text-red-900'>Diagnostic Error</p>
                      <p className='text-sm text-red-700'>{diagnostics.error}</p>
                    </div>
                  </div>
                ) : (
                  <>
                    {diagnostics.checks && diagnostics.checks.length > 0 && (
                      <div className='space-y-2'>
                        {diagnostics.checks.map((check: any, index: number) => (
                          <div key={index} className='flex items-start gap-3 p-3 bg-gray-50 border border-gray-200 rounded-md'>
                            {getStatusIcon(check.status)}
                            <div className='flex-1 min-w-0'>
                              <p className='text-sm font-medium text-gray-900'>{check.name}</p>
                              <p className='text-sm text-gray-600'>{check.message}</p>
                              {check.data && (
                                <div className='mt-2 text-xs text-gray-500'>
                                  {Object.entries(check.data).map(([key, value]) => (
                                    <div key={key} className='flex justify-between'>
                                      <span className='font-medium'>{key}:</span>
                                      <span>{String(value)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    
                    {diagnostics.webhookInfo && (
                      <div className='p-3 bg-blue-50 border border-blue-200 rounded-md'>
                        <p className='text-sm font-medium text-blue-900 mb-2'>Webhook Information</p>
                        <div className='text-xs text-blue-700 space-y-1'>
                          <div className='flex justify-between'>
                            <span>URL:</span>
                            <span className='font-mono text-xs break-all'>{diagnostics.webhookInfo.url || 'Not set'}</span>
                          </div>
                          <div className='flex justify-between'>
                            <span>Pending Updates:</span>
                            <span>{diagnostics.webhookInfo.pendingUpdateCount || 0}</span>
                          </div>
                          {diagnostics.webhookInfo.lastErrorMessage && (
                            <div className='flex justify-between'>
                              <span>Last Error:</span>
                              <span className='text-red-600'>{diagnostics.webhookInfo.lastErrorMessage}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </ConfigSection>
      )}

      <InstructionsSection>
        <ol className='list-inside list-decimal space-y-2'>
          <li>
            Message "/newbot" to{' '}
            <a
              href='https://t.me/BotFather'
              target='_blank'
              rel='noopener noreferrer'
              className='link text-primary underline transition-colors hover:text-primary/80'
              onClick={(e) => {
                e.stopPropagation()
                window.open('https://t.me/BotFather', '_blank', 'noopener,noreferrer')
                e.preventDefault()
              }}
            >
              @BotFather
            </a>{' '}
            in Telegram to create a bot and copy its token.
          </li>
          <li>Enter your Bot Token above.</li>
          <li>Save settings and any message sent to your bot will trigger the workflow.</li>
        </ol>
      </InstructionsSection>
    </div>
  )
}
