import { AlertTriangle, Check, CheckCircle, Copy } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
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

  const Icon = testResult.success ? CheckCircle : AlertTriangle

  return (
    <Alert
      variant={testResult.success ? 'default' : 'destructive'}
      className={cn(
        testResult.success &&
          'border-green-500/50 text-green-700 dark:border-green-500/60 dark:text-green-400 [&>svg]:text-green-500 dark:[&>svg]:text-green-400'
      )}
    >
      <Icon className="h-4 w-4" />
      <AlertDescription>
        {testResult.message}

        {showCurlCommand && testResult.success && testResult.test?.curlCommand && (
          <div className="mt-3 bg-black/10 dark:bg-white/10 p-2 rounded text-xs font-mono overflow-x-auto relative group border border-border">
            <span className="text-muted-foreground text-[10px] absolute top-1 left-2 font-sans">
              Example Request:
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1 h-6 w-6 opacity-70 hover:opacity-100 text-inherit"
              onClick={() => copyToClipboard(testResult.test?.curlCommand || '', 'curl-command')}
              aria-label="Copy cURL command"
            >
              {copied === 'curl-command' ? (
                <Check className="h-3 w-3" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </Button>
            <pre className="whitespace-pre-wrap break-all pt-4 pr-8">
              {testResult.test.curlCommand}
            </pre>
          </div>
        )}
      </AlertDescription>
    </Alert>
  )
}
