import { Button } from '@/platform/design-system/components'

interface RetryButtonProps {
  retrying?: boolean
  onRetry: () => void
}

export function RetryButton({ retrying, onRetry }: RetryButtonProps) {
  return (
    <Button size='compact' disabled={retrying} onClick={onRetry}>
      Try again
    </Button>
  )
}
