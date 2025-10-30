import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { cn } from '@/lib/utils'

interface TestResultDisplayProps {
  testResult: {
    success: boolean
    message?: string
    test?: {
      curlCommand?: string
      status?: number
      contentType?: string
      responseText?: string
      headers?: Record<string, string>
      samplePayload?: Record<string, any>
    }
  } | null
  copied: string | null
  copyToClipboard: (text: string, type: string) => void
  showCurlCommand?: boolean
}

export function TestResultDisplay({
  testResult,
  copied,
  copyToClipboard,
  showCurlCommand = false,
}: TestResultDisplayProps) {
  if (!testResult) return null

  return (
    <Notice
      variant={testResult.success ? 'success' : 'error'}
      title={testResult.success ? 'Webhook Test Successful' : 'Webhook Test Failed'}
      icon={testResult.success ? null : undefined}
      className={cn(
        'mb-4',
        testResult.success
          ? 'border-green-200 bg-green-50 dark:border-green-800/50 dark:bg-green-950/20'
          : 'border-red-200 bg-red-50 dark:border-red-800/50 dark:bg-red-950/20'
      )}
    >
      <div
        className={cn(
          'text-sm',
          testResult.success
            ? 'text-green-800 dark:text-green-300'
            : 'text-red-800 dark:text-red-300'
        )}
      >
        {testResult.message}

        {showCurlCommand && testResult.success && testResult.test?.curlCommand && (
          <div className='group relative mt-3 overflow-x-auto rounded border border-border bg-black/10 p-2 font-mono text-xs dark:bg-white/10'>
            <span className='absolute top-1 left-2 font-sans text-[10px] text-muted-foreground'>
              Example Request:
            </span>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className='absolute top-1 right-1 h-6 w-6 text-inherit opacity-70 hover:opacity-100'
              onClick={() => copyToClipboard(testResult.test?.curlCommand || '', 'curl-command')}
              aria-label='Copy cURL command'
            >
              {copied === 'curl-command' ? (
                <Check className='h-3 w-3' />
              ) : (
                <Copy className='h-3 w-3' />
              )}
            </Button>
            <pre className='whitespace-pre-wrap break-all pt-4 pr-8'>
              {testResult.test.curlCommand}
            </pre>
          </div>
        )}
      </div>
    </Notice>
  )
}
