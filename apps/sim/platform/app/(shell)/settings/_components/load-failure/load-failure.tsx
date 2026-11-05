import { Button, InlineNotice } from '@/platform/design-system/components'

interface LoadFailureProps {
  message: string
  onRetry: () => void
}

/** A read that failed, kept distinct from an empty list. */
export function LoadFailure({ message, onRetry }: LoadFailureProps) {
  return (
    <InlineNotice
      intent='danger'
      message={message}
      action={
        <Button variant='quiet' size='compact' onClick={onRetry}>
          Retry
        </Button>
      }
    />
  )
}
