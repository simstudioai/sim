import { AlertCircleIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

type AlertType = 'error' | 'email-error' | 'rate-limit' | null

interface WaitlistAlertProps {
  type: AlertType
  message: string
  onDismiss: () => void
  onRefresh?: () => void
}

export function WaitlistAlert({ type, message, onDismiss, onRefresh }: WaitlistAlertProps) {
  if (!type) return null

  return (
    <Alert
      variant={type === 'error' || type === 'email-error' ? 'destructive' : 'default'}
      className="mb-4"
    >
      <AlertCircleIcon className="h-4 w-4" />
      <AlertTitle className="ml-2">
        {type === 'email-error'
          ? 'Email Delivery Failed'
          : type === 'rate-limit'
            ? 'Rate Limit Exceeded'
            : 'Error'}
      </AlertTitle>
      <AlertDescription className="ml-2 flex items-center justify-between">
        <span>{message}</span>
        <div className="flex gap-2">
          {onRefresh && (
            <Button onClick={onRefresh} variant="outline" size="sm" className="ml-4">
              Try Again
            </Button>
          )}
          <Button onClick={onDismiss} variant="outline" size="sm" className="ml-4">
            Dismiss
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}
