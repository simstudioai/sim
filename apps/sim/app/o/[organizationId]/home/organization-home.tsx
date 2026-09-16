'use client'

import { useEffect, useState } from 'react'
import { useSession } from '@/lib/auth/auth-client'
import { getMothershipAttachmentPreviewUrl } from '@/lib/copilot/chat/attachment-preview'
import { MothershipHandoffStorage } from '@/lib/core/utils/browser-storage'
import { Composer } from '@/app/o/[organizationId]/home/components/composer'
import { GetStarted } from '@/app/o/[organizationId]/home/components/get-started'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { SearchIntegrationConnection } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/search-integration-connection'
import { MothershipChat } from '@/app/workspace/[workspaceId]/home/components/mothership-chat'
import { useChat } from '@/app/workspace/[workspaceId]/home/hooks/use-chat'
import type { FileAttachmentForApi } from '@/app/workspace/[workspaceId]/home/types'
import { useFileAttachments } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-file-attachments'
import { useMarkMothershipChatRead } from '@/hooks/queries/mothership-chats'

interface OrganizationHomeProps {
  userName?: string
  chatId?: string
}

/** Search and private Assistant chats for the routed organization. */
export function OrganizationHome(props: OrganizationHomeProps) {
  const { organization, searchAccess } = useOrganizationContext()
  if (!searchAccess.memberScoped) return null
  return <OrganizationHomeContent key={`${organization.id}:${props.chatId ?? 'new'}`} {...props} />
}

function OrganizationHomeContent({ userName, chatId }: OrganizationHomeProps) {
  const { organization } = useOrganizationContext()
  const { data: session } = useSession()
  const [draft, setDraft] = useState('')
  const chat = useChat({ organizationId: organization.id }, chatId)
  const files = useFileAttachments({ userId: session?.user?.id, organizationId: organization.id })
  const { sendMessage } = chat
  const { mutate: markRead } = useMarkMothershipChatRead({ organizationId: organization.id })
  const firstName = userName?.split(' ')[0] ?? ''

  useEffect(() => {
    if (chat.resolvedChatId && !chat.isSending && !chat.isReconnecting)
      markRead(chat.resolvedChatId)
  }, [chat.resolvedChatId, chat.isSending, chat.isReconnecting, markRead])

  useEffect(() => {
    if (chatId) return
    const handoff = MothershipHandoffStorage.consume({ organizationId: organization.id })
    if (handoff && (handoff.message || handoff.fileAttachments?.length)) {
      void sendMessage(handoff.message ?? '', handoff.fileAttachments, undefined, {
        requestMode: 'assistant',
        ...(handoff.resumeUserMessageId
          ? { resumeUserMessageId: handoff.resumeUserMessageId }
          : {}),
        ...(handoff.assistantSearch ? { assistantSearch: handoff.assistantSearch } : {}),
      })
    }
  }, [chatId, organization.id, sendMessage])

  const send = (message: string, fileAttachments?: FileAttachmentForApi[]) => {
    void sendMessage(message, fileAttachments, undefined, { requestMode: 'assistant' })
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

  return (
    <div className='flex h-full min-h-0 flex-col bg-[var(--bg)]'>
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
                <GetStarted />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
