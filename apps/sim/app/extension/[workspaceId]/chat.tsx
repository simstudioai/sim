'use client'

import { useMemo, useState } from 'react'
import {
  ChipModal,
  ChipModalHeader,
  cn,
  DropdownMenuItem,
  DropdownMenuSeparator,
  toast,
} from '@sim/emcn'
import { Globe, Highlighter, Settings } from '@sim/emcn/icons'
import { generateId } from '@sim/utils/id'
import { useQueryClient } from '@tanstack/react-query'
import { useQueryState, useQueryStates } from 'nuqs'
import { getPageContextBudgetError } from '@/lib/mothership/chat/page-context'
import type { WorkspaceResourceRef } from '@/lib/mothership/resources/types'
import { isWorkspaceResourceKind, workspaceResourcePath } from '@/lib/resources'
import { ExtensionHeader } from '@/app/extension/[workspaceId]/header'
import { PageContext } from '@/app/extension/[workspaceId]/page-context'
import {
  extensionChatParam,
  extensionSourceParams,
} from '@/app/extension/[workspaceId]/search-params'
import { usePageContext } from '@/app/extension/hooks/use-page-context'
import { useExtensionIdentity } from '@/app/extension/providers'
import { MothershipChat } from '@/app/workspace/[workspaceId]/home/components/mothership-chat/mothership-chat'
import { SourcesResourceContent } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/sources-resource-content'
import { useChat } from '@/app/workspace/[workspaceId]/home/hooks/use-chat'
import { fetchWorkspaceResourceRef } from '@/app/workspace/[workspaceId]/home/resolve-resource-ref'
import type { FileAttachmentForApi } from '@/app/workspace/[workspaceId]/home/types'
import { prepareContextForInsert } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/utils'
import type { ChatContext } from '@/stores/panel'

interface ExtensionChatProps {
  workspaceId: string
  workspaceName: string
}

export function ExtensionChat({ workspaceId, workspaceName }: ExtensionChatProps) {
  const { origins, userId } = useExtensionIdentity()
  const queryClient = useQueryClient()
  const [sourceParams, setSourceParams] = useQueryStates(extensionSourceParams)
  const [selectedChatId, setSelectedChatId] = useQueryState(
    extensionChatParam.key,
    extensionChatParam.parser
  )
  const [captureChatId, setCaptureChatId] = useState(selectedChatId)
  const [composerKey, setComposerKey] = useState(generateId)
  if (captureChatId !== selectedChatId) {
    setCaptureChatId(selectedChatId)
    setComposerKey(generateId())
  }
  const { snapshots, captureError, clearSnapshots, removeSnapshot, connected, requestAction } =
    usePageContext(origins, composerKey)
  const composerAttachments = useMemo(
    () =>
      snapshots.length > 0
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
  const composerResourceActions = useMemo(
    () =>
      connected ? (
        <>
          <DropdownMenuSeparator />
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
  const chat = useChat(workspaceId, selectedChatId ?? undefined, {
    apiPath: '/api/mothership/chat',
    stopPath: '/api/mothership/chat/stop',
    projectsDesktopTabs: false,
    onChatIdResolved: (chatId) => {
      setCaptureChatId(chatId)
      void setSelectedChatId(chatId)
    },
  })
  const appHref = `/workspace/${encodeURIComponent(workspaceId)}/${chat.resolvedChatId ? `chat/${encodeURIComponent(chat.resolvedChatId)}` : 'home'}`
  const sourceMessage = chat.messages.find(
    (message) =>
      message.role === 'assistant' &&
      (message.id === sourceParams['source-message'] ||
        (sourceParams['source-request'] && message.requestId === sourceParams['source-request']))
  )
  const closeSources = () =>
    void setSourceParams({ 'source-message': null, 'source-request': null }, { history: 'replace' })

  async function openResource(reference: WorkspaceResourceRef) {
    const destination = window.open('about:blank', '_blank')
    if (!destination) {
      toast.error('Allow pop-ups to open this resource in Sim.')
      return
    }
    destination.opener = null
    try {
      const resource = await fetchWorkspaceResourceRef(queryClient, workspaceId, reference, {
        fresh: true,
      })
      if (!resource) {
        destination.close()
        toast.error(`Couldn't find "${reference.title}" in this workspace`)
        return
      }
      const kind =
        resource.type === 'knowledgebase'
          ? 'knowledge'
          : resource.type === 'filefolder'
            ? 'folder'
            : resource.type
      destination.location.replace(
        isWorkspaceResourceKind(kind)
          ? workspaceResourcePath(workspaceId, kind, resource.id)
          : `${appHref}?resource=${encodeURIComponent(resource.id)}`
      )
    } catch {
      destination.close()
      toast.error('Could not open this resource. Try again.')
    }
  }

  const selectChat = (chatId: string | null) => {
    closeSources()
    void setSelectedChatId(chatId)
  }
  const submit = (message: string, files?: FileAttachmentForApi[], contexts?: ChatContext[]) => {
    const submittedContexts: ChatContext[] = [...(contexts ?? [])]
    let submittedMessage = message
    for (const snapshot of snapshots) {
      const pageContext = prepareContextForInsert(
        {
          kind: 'browser_page',
          label: snapshot.kind === 'selection' ? 'Selection' : 'Page',
          snapshot,
        },
        submittedContexts
      )
      if (pageContext) {
        submittedContexts.push(pageContext)
        submittedMessage += `\n\n@${pageContext.label}`
      }
    }
    const budgetError = getPageContextBudgetError(submittedContexts)
    if (budgetError) {
      toast.error(budgetError)
      return false
    }
    void chat.sendMessage(submittedMessage, files, submittedContexts)
    clearSnapshots()
  }

  return (
    <main className='ph-no-capture flex h-dvh min-w-0 flex-col overflow-hidden bg-[var(--bg)] text-[var(--text-body)]'>
      <ExtensionHeader
        workspaceId={workspaceId}
        workspaceName={workspaceName}
        chatId={chat.resolvedChatId}
        onSelectChat={selectChat}
        appHref={appHref}
      />
      {chat.error && (
        <p role='alert' className='px-3 py-2 text-[var(--text-error)] text-caption'>
          {chat.error}
        </p>
      )}
      {captureError && (
        <p role='alert' className='px-3 py-2 text-[var(--text-error)] text-caption'>
          {captureError}
        </p>
      )}
      {!selectedChatId && chat.messages.length === 0 && (
        <div className='flex flex-1 items-center justify-center px-5'>
          <h1 className='text-lg'>How can I help?</h1>
        </div>
      )}
      <MothershipChat
        workspaceId={workspaceId}
        userId={userId}
        chatId={chat.resolvedChatId}
        messages={chat.messages}
        isSending={chat.isSending}
        isReconnecting={chat.isReconnecting}
        isLoading={
          Boolean(selectedChatId) && chat.messages.length === 0 && chat.isChatHistoryPending
        }
        onSubmit={submit}
        onStopGeneration={() => void chat.stopGeneration()}
        messageQueue={chat.messageQueue}
        editingQueuedId={chat.editingQueuedId}
        dispatchingHeadId={chat.dispatchingHeadId}
        onRemoveQueuedMessage={chat.removeFromQueue}
        onSendQueuedMessage={chat.sendNow}
        onEditQueuedMessage={chat.editQueuedMessage}
        onCancelQueueEdit={chat.cancelQueueEdit}
        onViewSources={(messageId, requestId) =>
          void setSourceParams(
            { 'source-message': messageId, 'source-request': requestId ?? null },
            { history: 'push' }
          )
        }
        onWorkspaceResourceSelect={(resource) => void openResource(resource)}
        composerKey={composerKey}
        draftScopeKey={`extension:${userId}:${workspaceId}:${selectedChatId ?? 'new'}`}
        composerAttachments={composerAttachments}
        composerResourceActions={composerResourceActions}
        layout='copilot-view'
        className={cn(
          'h-auto min-h-0',
          selectedChatId || chat.messages.length > 0 ? 'flex-1' : 'shrink-0'
        )}
      />
      <ChipModal
        open={Boolean(sourceMessage)}
        onOpenChange={(open) => {
          if (!open) closeSources()
        }}
        srTitle='Cited sources'
        size='sm'
      >
        <ChipModalHeader onClose={closeSources}>Cited sources</ChipModalHeader>
        {sourceMessage && (
          <div className='h-[60dvh] min-h-0'>
            <SourcesResourceContent
              chatId={chat.resolvedChatId}
              resource={{
                id: 'cited-sources',
                type: 'sources',
                title: 'Sources',
                sources: {
                  messageId: sourceMessage.id,
                  ...(sourceParams['source-request']
                    ? { requestId: sourceParams['source-request'] }
                    : {}),
                },
              }}
            />
          </div>
        )}
      </ChipModal>
    </main>
  )
}
