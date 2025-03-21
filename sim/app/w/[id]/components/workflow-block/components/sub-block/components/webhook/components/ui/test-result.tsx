import { motion } from 'framer-motion'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'

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
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`p-3 rounded-md ${
        testResult.success
          ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300 border border-green-200 dark:border-green-800'
          : 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300 border border-red-200 dark:border-red-800'
      }`}
    >
      <p className="text-sm">{testResult.message}</p>

      {showCurlCommand && testResult.success && testResult.test?.curlCommand && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="mt-3 bg-black/10 dark:bg-white/10 p-2 rounded text-xs font-mono overflow-x-auto relative group"
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-2 top-2 h-6 w-6 opacity-70 hover:opacity-100"
            onClick={() => copyToClipboard(testResult.test?.curlCommand || '', 'curl-command')}
          >
            {copied === 'curl-command' ? (
              <Check className="h-3 w-3" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </Button>
          <pre className="whitespace-pre-wrap break-all pr-8">{testResult.test.curlCommand}</pre>
        </motion.div>
      )}
    </motion.div>
  )
}
