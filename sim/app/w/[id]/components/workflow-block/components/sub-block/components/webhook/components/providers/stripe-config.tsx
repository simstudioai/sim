interface StripeConfigProps {
  isLoadingToken: boolean
  testResult: {
    success: boolean
    message?: string
    test?: any
  } | null
  copied: string | null
  copyToClipboard: (text: string, type: string) => void
}

export function StripeConfig({
  isLoadingToken,
  testResult,
  copied,
  copyToClipboard,
}: StripeConfigProps) {
  return (
    <div className="space-y-2">
      <h4 className="font-medium">Setup Instructions</h4>
      <ol className="list-decimal list-inside space-y-1 text-sm">
        <li>Go to your Stripe Dashboard</li>
        <li>Navigate to Developers {'>'} Webhooks</li>
        <li>Click "Add endpoint"</li>
        <li>Enter the Webhook URL shown above</li>
        <li>Select the events you want to listen for</li>
        <li>Add the endpoint</li>
      </ol>

      <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-md mt-3 border border-gray-200 dark:border-gray-700">
        <p className="text-sm text-gray-700 dark:text-gray-300 flex items-center">
          <span className="text-gray-400 dark:text-gray-500 mr-2">💡</span>
          Stripe will send a test event to verify your webhook endpoint.
        </p>
      </div>
    </div>
  )
}
