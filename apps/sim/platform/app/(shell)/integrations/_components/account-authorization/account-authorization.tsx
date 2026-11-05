import { Modal } from '@/platform/design-system/components'
import type { AccountMethod, IntegrationAccount } from '@/platform/lib/integrations/model'

const AUTHORIZATION: Record<AccountMethod, string> = {
  oauth: 'Authorize your provider account to give Sim access.',
  slack: 'Authorize your member account with your organization’s Slack app.',
  mcp: 'Sign in to the managed MCP server with your own provider account.',
}

interface AccountAuthorizationProps {
  provider: string
  method: AccountMethod
  account?: IntegrationAccount
  candidateLabel?: string
  onClose: () => void
  onAuthorize?: () => void
}

export function AccountAuthorization({
  provider,
  method,
  account,
  candidateLabel,
  onClose,
  onAuthorize,
}: AccountAuthorizationProps) {
  const label = account?.label ?? candidateLabel
  return (
    <Modal
      open
      onOpenChange={onClose}
      title={account ? 'Reconnect account' : `Connect to ${provider}`}
      description={label ? `${label} · ${AUTHORIZATION[method]}` : AUTHORIZATION[method]}
      confirmLabel={account ? 'Reconnect' : 'Connect account'}
      confirmDisabled={!onAuthorize}
      onConfirm={onAuthorize}
    />
  )
}
