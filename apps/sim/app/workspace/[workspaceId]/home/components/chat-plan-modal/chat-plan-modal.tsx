'use client'

import { useEffect } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalDescription,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'
import { useRouter } from 'next/navigation'
import { CHAT_PLAN_REQUIRED_UPGRADE } from '@/lib/billing/chat-plan'
import { rememberSettingsReturnUrl } from '@/lib/navigation/settings-return'
import { usePlanUpgradeLink } from '@/app/workspace/[workspaceId]/home/hooks/use-plan-upgrade-link'
import { useChatPlanModalStore } from '@/stores/modals/chat-plan/store'

/**
 * Answers a send the workspace's plan refuses: Chat is on paid plans, with the way to upgrade
 * for a viewer who may, and who to ask for one who may not. Render it once per workspace shell;
 * leaving the shell closes it, so a refusal never reopens in the next workspace or organization.
 */
export function ChatPlanModal() {
  const isOpen = useChatPlanModalStore((state) => state.isOpen)
  const close = useChatPlanModalStore((state) => state.close)

  useEffect(() => close, [close])

  return (
    <ChipModal
      open={isOpen}
      onOpenChange={(open) => !open && close()}
      srTitle='Paid Plan Required'
      size='sm'
    >
      <ChatPlanModalContent onClose={close} />
    </ChipModal>
  )
}

interface ChatPlanModalContentProps {
  onClose: () => void
}

/** Mounted only while the modal shows, so a closed modal reads no session or billing context. */
function ChatPlanModalContent({ onClose }: ChatPlanModalContentProps) {
  const router = useRouter()
  const { href, opensInNewTab, buttonLabel, canManageBilling, unavailableMessage } =
    usePlanUpgradeLink(CHAT_PLAN_REQUIRED_UPGRADE)

  const upgrade = () => {
    onClose()
    if (opensInNewTab) {
      window.open(href, '_blank', 'noopener,noreferrer')
      return
    }
    rememberSettingsReturnUrl(href)
    router.push(href)
  }

  return (
    <>
      <ChipModalHeader onClose={onClose}>Paid Plan Required</ChipModalHeader>
      <ChipModalBody>
        <ChipModalDescription>
          {CHAT_PLAN_REQUIRED_UPGRADE.message}
          {!canManageBilling && ` ${unavailableMessage}`}
        </ChipModalDescription>
      </ChipModalBody>
      {canManageBilling ? (
        <ChipModalFooter
          onCancel={onClose}
          primaryAction={{ label: buttonLabel, onClick: upgrade }}
        />
      ) : (
        <ChipModalFooter onCancel={onClose} cancelLabel='Close' defaultAction='dismiss' />
      )}
    </>
  )
}
