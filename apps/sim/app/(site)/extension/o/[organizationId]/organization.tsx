'use client'

import { useState } from 'react'
import { generateId } from '@sim/utils/id'
import { useQueryState } from 'nuqs'
import { SettingsLoader } from '@/components/workspace-providers/settings-loader'
import { isApiClientError } from '@/lib/api/client/errors'
import { resourceParam, resourceUrlKeys } from '@/lib/mothership/chat/search-params'
import type { ChatRequestMode } from '@/lib/mothership/chat/types'
import { organizationRoutes } from '@/lib/navigation/paths'
import { OrganizationProvider } from '@/lib/organizations/provider'
import type { OrganizationSurfaceContext } from '@/lib/organizations/surface'
import { ExtensionHeader } from '@/app/(site)/extension/[workspaceId]/header'
import { extensionChatParam } from '@/app/(site)/extension/[workspaceId]/search-params'
import { useExtensionComposer } from '@/app/(site)/extension/hooks/use-composer'
import ExtensionLoading from '@/app/(site)/extension/loading'
import { PanelConversation } from '@/app/(site)/extension/o/[organizationId]/panel-conversation'
import { ExtensionSessionExpired } from '@/app/(site)/extension/providers'
import { ExtensionUnavailable } from '@/app/(site)/extension/unavailable'
import { useOrganizationMothershipChats } from '@/hooks/queries/mothership-chats'
import { useOrganizationSummary } from '@/hooks/queries/organization'
import { VoiceInputPermissionContext } from '@/hooks/use-voice-input'

interface ExtensionOrganizationProps {
  context: OrganizationSurfaceContext
}

export function ExtensionOrganization({ context }: ExtensionOrganizationProps) {
  const access = useOrganizationSummary(context.organization.id)
  const history = useOrganizationMothershipChats(context.organization.id)
  const denied = [access.error, history.error].find(
    (error) => isApiClientError(error) && [401, 403, 404].includes(error.status)
  )
  if (isApiClientError(denied) && denied.status === 401) return <ExtensionSessionExpired />
  if (access.isPending) return <ExtensionLoading />
  if (denied || !access.data?.chatAccess)
    return (
      <ExtensionUnavailable
        scope='organization'
        onRetry={() => {
          void access.refetch()
          void history.refetch()
        }}
      />
    )
  const refreshedContext = { ...context, ...access.data.chatAccess }
  return (
    <OrganizationProvider context={refreshedContext}>
      <SettingsLoader />
      <ExtensionOrganizationChat context={refreshedContext} history={history} />
    </OrganizationProvider>
  )
}

interface ExtensionOrganizationChatProps extends ExtensionOrganizationProps {
  history: ReturnType<typeof useOrganizationMothershipChats>
}

function ExtensionOrganizationChat({ context, history }: ExtensionOrganizationChatProps) {
  const [, setResource] = useQueryState(resourceParam.key, {
    ...resourceParam.parser,
    ...resourceUrlKeys,
  })
  const [selectedChatId, setSelectedChatId] = useQueryState(
    extensionChatParam.key,
    extensionChatParam.parser
  )
  const [captureChatId, setCaptureChatId] = useState(selectedChatId)
  const [initialChatId, setInitialChatId] = useState(selectedChatId)
  const [submittedMode, setSubmittedMode] = useState<ChatRequestMode | null>(null)
  const [composerKey, setComposerKey] = useState(generateId)
  if (captureChatId !== selectedChatId) {
    setCaptureChatId(selectedChatId)
    setInitialChatId(selectedChatId)
    setSubmittedMode(null)
    setComposerKey(generateId())
  }
  const selectChat = (chatId: string | null) => {
    if (chatId === selectedChatId) {
      setInitialChatId(chatId)
      setSubmittedMode(null)
      setComposerKey(generateId())
    }
    void setResource(null)
    void setSelectedChatId(chatId)
  }
  const selectedChat = initialChatId
    ? history.data?.find((chat) => chat.id === initialChatId)
    : undefined
  if (initialChatId && !history.data && history.isPending) return <ExtensionLoading />
  if (initialChatId && !selectedChat)
    return <ExtensionUnavailable scope='chat' onRetry={() => void history.refetch()} />
  const requestMode = initialChatId
    ? selectedChat?.mode
    : (submittedMode ?? (context.canBuild ? 'agent' : 'assistant'))
  if (!requestMode)
    return history.isFetching ? (
      <ExtensionLoading />
    ) : (
      <ExtensionUnavailable scope='chat' onRetry={() => void history.refetch()} />
    )
  if (
    !context.mothershipAvailable ||
    (requestMode === 'assistant' ? !context.searchAccess.memberScoped : !context.canBuild)
  )
    return (
      <ExtensionUnavailable
        scope='chat'
        onBackToChat={
          context.mothershipAvailable && (context.canBuild || context.searchAccess.memberScoped)
            ? () => selectChat(null)
            : undefined
        }
      />
    )
  return (
    <ExtensionOrganizationConversation
      key={composerKey}
      context={context}
      history={history}
      scopeKey={composerKey}
      initialChatId={initialChatId ?? undefined}
      selectedChatId={selectedChatId ?? undefined}
      requestMode={requestMode}
      onSelectChat={selectChat}
      onCommitMode={() => setSubmittedMode(requestMode)}
      onChatIdResolved={(chatId) => {
        setCaptureChatId(chatId)
        void setSelectedChatId(chatId)
      }}
    />
  )
}

interface ExtensionOrganizationConversationProps extends ExtensionOrganizationChatProps {
  scopeKey: string
  initialChatId?: string
  selectedChatId?: string
  requestMode: ChatRequestMode
  onSelectChat: (chatId: string | null) => void
  onCommitMode: () => void
  onChatIdResolved: (chatId: string) => void
}

function ExtensionOrganizationConversation({
  context,
  history,
  scopeKey,
  initialChatId,
  selectedChatId,
  requestMode,
  onSelectChat,
  onCommitMode,
  onChatIdResolved,
}: ExtensionOrganizationConversationProps) {
  const composer = useExtensionComposer(scopeKey)
  const routes = organizationRoutes(context.organization.id)
  const appHref = selectedChatId
    ? requestMode === 'assistant'
      ? routes.searchChat(selectedChatId)
      : routes.chat(selectedChatId)
    : requestMode === 'assistant'
      ? routes.search
      : routes.home
  return (
    <VoiceInputPermissionContext value={composer.openMicrophoneSettings}>
      <PanelConversation
        chatId={initialChatId}
        requestMode={requestMode}
        attachments={composer.attachments}
        resourceActions={composer.resourceActions}
        toolbarActions={composer.toolbarActions}
        modelSelectorOptions={composer.modelSelectorOptions}
        prepareSubmission={composer.prepareSubmission}
        onSubmitted={() => {
          onCommitMode()
          composer.onSubmitted()
        }}
        draftNamespace='extension'
        onChatIdResolved={onChatIdResolved}
        onNavigateToChat={onSelectChat}
        header={
          <>
            <ExtensionHeader
              scopeName={context.organization.name}
              history={history}
              chatId={selectedChatId}
              onSelectChat={onSelectChat}
              appHref={appHref}
            />
            {composer.captureError && (
              <p role='alert' className='px-3 py-2 text-[var(--text-error)] text-caption'>
                {composer.captureError}
              </p>
            )}
          </>
        }
      />
    </VoiceInputPermissionContext>
  )
}
