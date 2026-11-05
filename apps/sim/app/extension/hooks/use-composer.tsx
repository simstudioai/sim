'use client'

import { useCallback, useMemo } from 'react'
import type { PageSnapshot } from '@sim/browser-extension-protocol'
import { Chip, DropdownMenuCheckboxItem, DropdownMenuItem, Tooltip, toast } from '@sim/emcn'
import { Globe, Highlighter, Settings } from '@sim/emcn/icons'
import { getPageContextBudgetError } from '@/lib/mothership/chat/page-context'
import { usePageContext } from '@/app/extension/hooks/use-page-context'
import { useExtensionIdentity } from '@/app/extension/providers'
import { PageContext } from '@/app/workspace/[workspaceId]/home/components/message-content/components/page-context'
import { prepareContextForInsert } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/utils'
import {
  PendingComposerSubmission,
  type PrepareChatSubmission,
} from '@/hooks/use-composer-submission'
import type { ChatContext } from '@/stores/panel'

const MODEL_SELECTOR_OPTIONS = { showModelPicker: false, fastModeDescription: 'Fast mode' } as const

/** Adds ephemeral captures to either shared chat composer at its submission boundary. */
export function useExtensionComposer(scopeKey: string) {
  const { origins } = useExtensionIdentity()
  const {
    snapshots,
    captureError,
    clearSnapshots,
    removeSnapshot,
    connected,
    requestAction,
    referenceEnabled,
    setReferenceEnabled,
    captureForSend,
  } = usePageContext(origins, scopeKey)
  const attachments = useMemo(
    () =>
      snapshots.length
        ? snapshots.map((snapshot) => (
            <PageContext
              key={snapshot.id}
              snapshot={snapshot}
              onRemove={() => removeSnapshot(snapshot.id)}
            />
          ))
        : undefined,
    [snapshots, removeSnapshot]
  )
  const resourceActions = useMemo(
    () =>
      connected ? (
        <>
          <DropdownMenuItem onSelect={() => requestAction('capture-page')}>
            <Globe className='size-[14px]' />
            Current page
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => requestAction('capture-selection')}>
            <Highlighter className='size-[14px]' />
            Selected text
          </DropdownMenuItem>
          {referenceEnabled !== undefined && (
            <DropdownMenuCheckboxItem
              checked={referenceEnabled}
              onCheckedChange={setReferenceEnabled}
              aria-description='Include the active tab when you send a message'
            >
              Reference current page on send
            </DropdownMenuCheckboxItem>
          )}
          <DropdownMenuItem onSelect={() => requestAction('site-access')}>
            <Settings className='size-[14px]' />
            Page access
          </DropdownMenuItem>
        </>
      ) : undefined,
    [connected, requestAction, referenceEnabled, setReferenceEnabled]
  )
  const prepareSubmission = useCallback<PrepareChatSubmission>(
    (text, contexts, send, reference = true) => {
      const commit = (pages: PageSnapshot[]) => {
        const submittedContexts: ChatContext[] = [...(contexts ?? [])]
        let message = text
        for (const snapshot of pages) {
          const context = prepareContextForInsert(
            {
              kind: 'browser_page',
              label: snapshot.kind === 'selection' ? 'Selection' : 'Page',
              snapshot,
            },
            submittedContexts
          )
          if (context) {
            submittedContexts.push(context)
            message += `\n\n@${context.label}`
          }
        }
        const error = getPageContextBudgetError(submittedContexts)
        if (error) {
          toast.error(error)
          return false
        }
        return send({ message, contexts: submittedContexts })
      }
      const hasPage =
        snapshots.length > 0 || contexts?.some((context) => context.kind === 'browser_page')
      if (reference && !hasPage && referenceEnabled !== false) {
        if (!connected && window.parent !== window) {
          toast.info('Connecting to Sim. Try again in a moment.')
          return false
        }
        if (referenceEnabled) {
          return new PendingComposerSubmission(
            captureForSend().then((snapshot) => (snapshot ? () => commit([snapshot]) : false))
          )
        }
      }
      return commit(snapshots)
    },
    [captureForSend, connected, referenceEnabled, snapshots]
  )
  const toolbarActions = useMemo(
    () =>
      connected ? (
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Chip
              shape='round'
              active={referenceEnabled}
              leftIcon={Globe}
              aria-description={
                referenceEnabled
                  ? 'Reference current page is on. The active page is included when you send.'
                  : undefined
              }
              onClick={() => requestAction('capture-page')}
              aria-label='Attach current page'
            >
              {referenceEnabled ? 'Current page' : undefined}
            </Chip>
          </Tooltip.Trigger>
          <Tooltip.Content side='top'>
            {referenceEnabled
              ? 'Includes the active page when you send. Click to attach it now.'
              : 'Attach current page'}
          </Tooltip.Content>
        </Tooltip.Root>
      ) : undefined,
    [connected, requestAction, referenceEnabled]
  )
  const openMicrophoneSettings = useCallback(
    () => requestAction('microphone-settings'),
    [requestAction]
  )
  return {
    openMicrophoneSettings: connected ? openMicrophoneSettings : null,
    attachments,
    resourceActions,
    toolbarActions,
    modelSelectorOptions: MODEL_SELECTOR_OPTIONS,
    prepareSubmission,
    onSubmitted: clearSnapshots,
    captureError,
  }
}
