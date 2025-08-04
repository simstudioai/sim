import { JSONView } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/console/components'

interface TriggerTestResultProps {
  testResult: {
    success: boolean
    message?: string
    data?: any
  } | null
}

export function TriggerTestResult({ testResult }: TriggerTestResultProps) {
  if (!testResult) return null

  return (
    <div className='space-y-4'>
      <div
        className={`rounded-md border p-4 ${
          testResult.success
            ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950'
            : 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950'
        }`}
      >
        <div className='mb-2 flex items-center gap-2'>
          <div
            className={`h-2 w-2 rounded-full ${testResult.success ? 'bg-green-500' : 'bg-red-500'}`}
          />
          <span
            className={`font-medium text-sm ${
              testResult.success
                ? 'text-green-800 dark:text-green-200'
                : 'text-red-800 dark:text-red-200'
            }`}
          >
            {testResult.success ? 'Test Successful' : 'Test Failed'}
          </span>
        </div>

        {testResult.message && (
          <p
            className={`text-sm ${
              testResult.success
                ? 'text-green-700 dark:text-green-300'
                : 'text-red-700 dark:text-red-300'
            }`}
          >
            {testResult.message}
          </p>
        )}

        {testResult.data && (
          <div className='mt-3'>
            <p className='mb-2 font-medium text-sm'>Test Payload:</p>
            <div className='rounded border bg-background p-2 text-xs'>
              <JSONView data={testResult.data} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
