import { Chip, ChipLink } from '@sim/emcn'

interface ExtensionUnavailableProps {
  scope: 'organization' | 'workspace' | 'chat'
  onRetry?: () => void
  onBackToChat?: () => void
}

export function ExtensionUnavailable({ scope, onRetry, onBackToChat }: ExtensionUnavailableProps) {
  return (
    <main className='flex h-dvh flex-col items-center justify-center gap-4 bg-[var(--bg)] p-6 text-[var(--text-body)] text-small'>
      <p>This {scope} is unavailable.</p>
      {onRetry && <Chip onClick={onRetry}>Retry</Chip>}
      {onBackToChat ? (
        <Chip onClick={onBackToChat}>Back to chat</Chip>
      ) : (
        <ChipLink href='/extension'>Back to chat</ChipLink>
      )}
    </main>
  )
}
