'use client'

import { useCallback, useMemo } from 'react'
import { Chip, DropdownMenuItem, Tooltip, toast } from '@sim/emcn'
import { Globe, Highlighter, Settings } from '@sim/emcn/icons'
import { getPageContextBudgetError } from '@/lib/mothership/chat/page-context'
import { usePageContext } from '@/app/extension/hooks/use-page-context'
import { useExtensionIdentity } from '@/app/extension/providers'
import { PageContext } from '@/app/workspace/[workspaceId]/home/components/message-content/components/page-context'
import { prepareContextForInsert } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/utils'
import type { ChatContext } from '@/stores/panel'

const MODEL_SELECTOR_OPTIONS = { showModelPicker: false, fastModeDescription: 'Fast mode' } as const

/** Adds ephemeral captures to either shared chat composer at its submission boundary. */
export function useExtensionComposer(scopeKey: string) {
  const { origins } = useExtensionIdentity()
  const { snapshots, captureError, clearSnapshots, removeSnapshot, connected, requestAction } =
    usePageContext(origins, scopeKey)
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
          <DropdownMenuItem onSelect={() => requestAction('site-access')}>
            <Settings className='size-[14px]' />
            Site access
          </DropdownMenuItem>
        </>
      ) : undefined,
    [connected, requestAction]
  )
  const prepareSubmission = useCallback(
    (message: string, contexts?: ChatContext[]) => {
      const submittedContexts: ChatContext[] = [...(contexts ?? [])]
      let submittedMessage = message
      for (const snapshot of snapshots) {
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
          submittedMessage += `\n\n@${context.label}`
        }
      }
      const error = getPageContextBudgetError(submittedContexts)
      if (error) {
        toast.error(error)
        return false
      }
      return { message: submittedMessage, contexts: submittedContexts }
    },
    [snapshots]
  )
  const toolbarActions = useMemo(
    () =>
      connected ? (
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Chip
              shape='round'
              leftIcon={Globe}
              onClick={() => requestAction('capture-page')}
              aria-label='Attach current page'
            />
          </Tooltip.Trigger>
          <Tooltip.Content side='top'>Attach current page</Tooltip.Content>
        </Tooltip.Root>
      ) : undefined,
    [connected, requestAction]
  )
  return {
    attachments,
    resourceActions,
    toolbarActions,
    modelSelectorOptions: MODEL_SELECTOR_OPTIONS,
    prepareSubmission,
    onSubmitted: clearSnapshots,
    captureError,
  }
}
