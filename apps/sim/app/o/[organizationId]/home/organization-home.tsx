'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from '@sim/emcn'
import { useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { getWorkspaceHostContextContract } from '@/lib/api/contracts/workspaces'
import { useSession } from '@/lib/auth/auth-client'
import { MothershipHandoffStorage } from '@/lib/core/utils/browser-storage'
import { getMothershipAttachmentPreviewUrl } from '@/lib/mothership/chat/attachment-preview'
import { Composer } from '@/app/o/[organizationId]/home/components/composer'
import { GetStarted } from '@/app/o/[organizationId]/home/components/get-started'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { ChatResourcePanel } from '@/app/workspace/[workspaceId]/home/components/chat-resource-panel'
import { SearchIntegrationConnection } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/search-integration-connection'
import { MothershipChat } from '@/app/workspace/[workspaceId]/home/components/mothership-chat'
import { useChat } from '@/app/workspace/[workspaceId]/home/hooks/use-chat'
import {
  useChatResourcePanel,
  useResourcePanelController,
} from '@/app/workspace/[workspaceId]/home/hooks/use-resource-panel'
import { resolveWorkspaceResourceRef } from '@/app/workspace/[workspaceId]/home/resolve-resource-ref'
import type {
  ChatRequestMode,
  FileAttachmentForApi,
  WorkspaceResourceRef,
} from '@/app/workspace/[workspaceId]/home/types'
import { useFileAttachments } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-file-attachments'
import { useMarkMothershipChatRead } from '@/hooks/queries/mothership-chats'
import { getWorkspaceFilesQueryOptions } from '@/hooks/queries/workspace-files'

interface OrganizationHomeProps {
  userName?: string
  chatId?: string
  requestMode?: ChatRequestMode
}

/** Private organization chats, with an explicit Home or Search conversation intent. */
export function OrganizationHome(props: OrganizationHomeProps) {
  const { organization, searchAccess, mothershipAvailable } = useOrganizationContext()
  if (props.requestMode === 'assistant' ? !searchAccess.memberScoped : !mothershipAvailable)
    return null
  return (
    <OrganizationHomeContent
      key={`${organization.id}:${props.chatId ?? 'new'}:${props.requestMode ?? 'agent'}`}
      {...props}
    />
  )
}

function OrganizationHomeContent({
  userName,
  chatId,
  requestMode = 'agent',
}: OrganizationHomeProps) {
  const { organization, searchAccess } = useOrganizationContext()
  const { data: session } = useSession()
  const [draft, setDraft] = useState('')
  const controller = useResourcePanelController()
  const queryClient = useQueryClient()
  const chat = useChat({ organizationId: organization.id }, chatId, {
    requestMode,
    projectsDesktopTabs: requestMode === 'agent',
    onResourceEvent: controller.onResourceEvent,
    activeResourceState: controller.activeResourceState,
  })
  const panel = useChatResourcePanel(chat, controller)
  const addResource = panel.addResourceFromUser
  const selectResource = useCallback(
    async (ref: WorkspaceResourceRef) => {
      if (!ref.workspaceId) {
        toast.error('This resource has no workspace address.')
        return
      }
      try {
        const host = await requestJson(getWorkspaceHostContextContract, {
          params: { id: ref.workspaceId },
        })
        if (host.hostOrganizationId !== organization.id) {
          toast.error('This resource is outside this organization.')
          return
        }
        const files =
          ref.type === 'file'
            ? await queryClient.fetchQuery(getWorkspaceFilesQueryOptions(ref.workspaceId))
            : []
        const resource = resolveWorkspaceResourceRef(ref, files)
        if (!resource) {
          toast.error(`Couldn't find "${ref.title}" in its workspace`)
          return
        }
        addResource({ ...resource, workspaceId: ref.workspaceId })
      } catch {
        toast.error(`Couldn't open "${ref.title}". Check your access and try again.`)
      }
    },
    [queryClient, addResource, organization.id]
  )
  const files = useFileAttachments({
    userId: session?.user?.id,
    organizationId: organization.id,
    requestMode,
  })
  const { sendMessage } = chat
  const { mutate: markRead } = useMarkMothershipChatRead({ organizationId: organization.id })
  const firstName = userName?.split(' ')[0] ?? ''

  useEffect(() => {
    if (chat.resolvedChatId && !chat.isSending && !chat.isReconnecting)
      markRead(chat.resolvedChatId)
  }, [chat.resolvedChatId, chat.isSending, chat.isReconnecting, markRead])

  useEffect(() => {
    if (chatId) return
    const handoff = MothershipHandoffStorage.consume(
      { organizationId: organization.id },
      undefined,
      requestMode
    )
    if (handoff && (handoff.message || handoff.fileAttachments?.length)) {
      void sendMessage(handoff.message ?? '', handoff.fileAttachments, undefined, {
        requestMode,
        ...(handoff.resumeUserMessageId
          ? { resumeUserMessageId: handoff.resumeUserMessageId }
          : {}),
        ...(handoff.assistantSearch ? { assistantSearch: handoff.assistantSearch } : {}),
      })
    }
  }, [chatId, organization.id, requestMode, sendMessage])

  const send = (message: string, fileAttachments?: FileAttachmentForApi[]) => {
    panel.prepareResourceViewForAgentTurn()
    void sendMessage(message, fileAttachments, undefined, { requestMode })
  }

  const submit = () => {
    const message = draft.trim()
    if (files.attachedFiles.some((file) => file.uploading)) return
    const attachments: FileAttachmentForApi[] = files.attachedFiles
      .filter((file) => file.key)
      .map((file) => ({
        id: file.id,
        key: file.key!,
        filename: file.name,
        media_type: file.type,
        size: file.size,
        path: file.path,
      }))
    if (!message && !attachments.length) return
    setDraft('')
    send(message, attachments.length ? attachments : undefined)
    files.clearAttachedFiles()
  }

  const hasChat = Boolean(chatId || chat.messages.length)
  const composer = (
    <Composer
      requestMode={requestMode}
      value={draft}
      files={files}
      isInitialView={!hasChat}
      isSending={chat.isSending || chat.isReconnecting}
      onChange={setDraft}
      onSubmit={submit}
      onStop={() => {
        void chat.stopGeneration()
      }}
    />
  )

  const content = (
    <div className='flex h-full min-h-0 min-w-[240px] flex-1 flex-col bg-[var(--bg)]'>
      {hasChat ? (
        <MothershipChat
          SearchConnectionComponent={SearchIntegrationConnection}
          messages={chat.messages}
          isSending={chat.isSending}
          isReconnecting={chat.isReconnecting}
          isLoading={Boolean(chatId) && !chat.messages.length && chat.isChatHistoryPending}
          onSubmit={send}
          onStopGeneration={() => {
            void chat.stopGeneration()
          }}
          messageQueue={chat.messageQueue}
          editingQueuedId={chat.editingQueuedId}
          dispatchingHeadId={chat.dispatchingHeadId}
          onRemoveQueuedMessage={chat.removeFromQueue}
          onSendQueuedMessage={chat.sendNow}
          onEditQueuedMessage={(id) => {
            const queued = chat.editQueuedMessage(id)
            if (queued) {
              setDraft(queued.content)
              files.restoreAttachedFiles(
                (queued.fileAttachments ?? []).map((file) => ({
                  id: file.id,
                  key: file.key,
                  name: file.filename,
                  type: file.media_type,
                  size: file.size,
                  path: file.path || getMothershipAttachmentPreviewUrl(file) || '',
                  previewUrl: getMothershipAttachmentPreviewUrl(file),
                  uploading: false,
                }))
              )
            }
            return queued
          }}
          onCancelQueueEdit={chat.cancelQueueEdit}
          userId={session?.user?.id}
          chatId={chat.resolvedChatId}
          composer={composer}
          onWorkspaceResourceSelect={requestMode === 'agent' ? selectResource : undefined}
          initialScrollBlocked={
            requestMode === 'agent' && chat.resources.length > 0 && panel.isResourceCollapsed
          }
        />
      ) : (
        <div className='min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable_both-edges]'>
          {/* Asymmetric padding biases the group up so the full cluster (heading + input + steps) sits at the optical center */}
          <div className='flex min-h-full flex-col items-center justify-center px-6 pt-[2vh] pb-[22vh]'>
            <h1 className='mb-7 max-w-chat text-balance font-season text-[26px] text-[var(--text-primary)] leading-[1.15] tracking-[-0.01em] sm:text-[28px]'>
              What should we get done{firstName ? `, ${firstName}` : ''}?
            </h1>
            <div className='relative w-full max-w-chat'>
              {composer}
              {/* Anchored out of flow so expanding/collapsing never shifts the centered input */}
              <div className='absolute inset-x-0 top-full'>
                {searchAccess.memberScoped && <GetStarted />}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
  return requestMode === 'agent' ? (
    <ChatResourcePanel organizationId={organization.id} chat={chat} panel={panel}>
      {content}
    </ChatResourcePanel>
  ) : (
    content
  )
}
