'use client'

import { type RefObject, useCallback, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import {
  AGENT_STREAM_PROTOCOL_HEADER,
  AGENT_STREAM_PROTOCOL_V1,
} from '@/lib/workflows/streaming/agent-stream-protocol'
import { DesktopTitleBarLane } from '@/app/_shell/desktop-title-bar'
import {
  ChatErrorState,
  ChatHeader,
  ChatInput,
  ChatLoadingState,
  type ChatMessage,
  ChatMessageContainer,
  EmailAuth,
  PasswordAuth,
} from '@/app/(interfaces)/chat/components'
import { CHAT_ERROR_MESSAGES, CHAT_REQUEST_TIMEOUT_MS } from '@/app/(interfaces)/chat/constants'
import { useChatStreaming } from '@/app/(interfaces)/chat/hooks'
import SSOAuth from '@/ee/sso/components/sso-auth'
import { useDeployedChatConfig } from '@/hooks/queries/chats'
import { useGitHubStars } from '@/hooks/queries/github-stars'

const logger = createLogger('ChatClient')

const NEAR_BOTTOM_THRESHOLD_PX = 100

interface ChatRequestFile {
  name: string
  size: number
  type: string
  data: string
}

interface ChatRequestPayload {
  input: string
  conversationId: string
  files?: ChatRequestFile[]
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function ChatClient({ identifier }: { identifier: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const [conversationId] = useState(() => generateId())

  const [showScrollButton, setShowScrollButton] = useState(false)
  /** ChatGPT-style: follow new tokens only while the viewport is near the bottom. */
  const stickToBottomRef = useRef(true)
  const ignoreScrollRef = useRef(false)

  const { data: chatConfigResult, error: chatConfigError } = useDeployedChatConfig(identifier)
  const { data: starCount } = useGitHubStars()

  const authRequired = chatConfigResult?.kind === 'auth' ? chatConfigResult.authType : null
  const chatConfig = chatConfigResult?.kind === 'config' ? chatConfigResult.config : null

  const welcomeMessage = chatConfig?.customizations?.welcomeMessage
  const welcomeChatMessage = useMemo<ChatMessage | null>(
    () =>
      welcomeMessage
        ? {
            id: 'welcome',
            content: welcomeMessage,
            type: 'assistant',
            timestamp: new Date(),
            isInitialMessage: true,
          }
        : null,
    [welcomeMessage]
  )
  const displayMessages: ChatMessage[] = welcomeChatMessage
    ? [welcomeChatMessage, ...messages]
    : messages

  const { isStreamingResponse, abortControllerRef, stopStreaming, handleStreamedResponse } =
    useChatStreaming()

  /**
   * ChatGPT-style scroll. Without `force`, no-ops when the user has scrolled away.
   * With `force` (jump button), re-pins to bottom.
   */
  const scrollToBottom = (options?: { behavior?: ScrollBehavior; force?: boolean }) => {
    const behavior = options?.behavior ?? 'smooth'
    const force = options?.force === true
    if (!force && !stickToBottomRef.current) return
    if (!messagesEndRef.current) return

    if (force) {
      stickToBottomRef.current = true
      setShowScrollButton(false)
    }

    ignoreScrollRef.current = true
    messagesEndRef.current.scrollIntoView({ behavior })
    window.setTimeout(
      () => {
        ignoreScrollRef.current = false
      },
      behavior === 'smooth' ? 400 : 50
    )
  }

  const scrollToMessage = (messageId: string) => {
    const messageElement = document.querySelector(`[data-message-id="${messageId}"]`)
    if (!messageElement || !messagesContainerRef.current) return

    const container = messagesContainerRef.current
    const containerRect = container.getBoundingClientRect()
    const messageRect = messageElement.getBoundingClientRect()

    container.scrollTo({
      top: container.scrollTop + messageRect.top - containerRect.top,
      behavior: 'smooth',
    })
  }

  /**
   * Attaches on mount via a ref callback rather than an effect: the container
   * renders only after the auth/loading early returns, so an effect would need
   * unrelated render values as a stand-in for "the node exists yet".
   */
  const attachMessagesContainer = useCallback((node: HTMLDivElement | null) => {
    messagesContainerRef.current = node
    if (!node) return

    const handleScroll = () => {
      if (ignoreScrollRef.current) return
      const { scrollTop, scrollHeight, clientHeight } = node
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight
      const nearBottom = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD_PX
      stickToBottomRef.current = nearBottom
      setShowScrollButton(!nearBottom)
    }

    node.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      node.removeEventListener('scroll', handleScroll)
      messagesContainerRef.current = null
    }
  }, [])

  const handleSendMessage = async (
    messageToSend: string,
    files?: Array<{
      id: string
      name: string
      size: number
      type: string
      file: File
      dataUrl?: string
    }>
  ) => {
    if ((!messageToSend.trim() && (!files || files.length === 0)) || isLoading) return

    logger.info('Sending message:', {
      messageToSend,
      conversationId,
      filesCount: files?.length,
    })

    stickToBottomRef.current = true
    setShowScrollButton(false)

    const userMessage: ChatMessage = {
      id: generateId(),
      content: messageToSend || (files && files.length > 0 ? `Sent ${files.length} file(s)` : ''),
      type: 'user',
      timestamp: new Date(),
      attachments: files?.map((file) => ({
        id: file.id,
        name: file.name,
        type: file.type,
        size: file.size,
        dataUrl: file.dataUrl || '',
      })),
    }

    setMessages((prev) => [...prev, userMessage])
    setIsLoading(true)

    setTimeout(() => {
      scrollToMessage(userMessage.id)
    }, 100)

    // One AbortController for fetch + SSE body reads so Stop cancels server work too.
    const abortController = new AbortController()
    abortControllerRef.current = abortController
    const timeoutId = setTimeout(() => {
      abortController.abort()
    }, CHAT_REQUEST_TIMEOUT_MS)

    try {
      const payloadFiles =
        files && files.length > 0
          ? await Promise.all(
              files.map(async (file) => ({
                name: file.name,
                size: file.size,
                type: file.type,
                data: file.dataUrl || (await fileToBase64(file.file)),
              }))
            )
          : undefined

      const payload: ChatRequestPayload = {
        input:
          typeof userMessage.content === 'string'
            ? userMessage.content
            : JSON.stringify(userMessage.content),
        conversationId,
        ...(payloadFiles ? { files: payloadFiles } : {}),
      }

      logger.info('API payload:', {
        ...payload,
        files: payload.files ? `${payload.files.length} files` : undefined,
      })

      // boundary-raw-fetch: deployed chat endpoint returns an SSE stream consumed by handleStreamedResponse via response.body.getReader()
      const response = await fetch(`/api/chat/${identifier}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          [AGENT_STREAM_PROTOCOL_HEADER]: AGENT_STREAM_PROTOCOL_V1,
        },
        body: JSON.stringify(payload),
        credentials: 'same-origin',
        signal: abortController.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorData = await response.json()
        logger.error('API error response:', errorData)
        throw new Error(errorData.error || 'Failed to get response')
      }

      if (!response.body) {
        throw new Error('Response body is missing')
      }

      await handleStreamedResponse(
        response,
        setMessages,
        setIsLoading,
        () => scrollToBottom({ behavior: 'auto' }),
        {
          outputConfigs: chatConfig?.outputConfigs,
          abortController,
        }
      )
    } catch (error) {
      clearTimeout(timeoutId)

      if (error instanceof Error && error.name === 'AbortError') {
        logger.info('Request aborted by user or timeout')
        setIsLoading(false)
        return
      }

      logger.error('Error sending message:', error)
      setIsLoading(false)
      const errorMessage: ChatMessage = {
        id: generateId(),
        content: CHAT_ERROR_MESSAGES.GENERIC_ERROR,
        type: 'assistant',
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMessage])
    }
  }

  if (chatConfigError) {
    logger.error('Error fetching chat config:', chatConfigError)
    return <ChatErrorState error={CHAT_ERROR_MESSAGES.CHAT_UNAVAILABLE} />
  }

  if (authRequired) {
    if (authRequired === 'password') {
      return <PasswordAuth identifier={identifier} />
    }
    if (authRequired === 'email') {
      return <EmailAuth identifier={identifier} />
    }
    if (authRequired === 'sso') {
      return <SSOAuth identifier={identifier} />
    }
  }

  if (!chatConfig) {
    return <ChatLoadingState />
  }

  return (
    <div className='light desktop-title-bar-page fixed inset-0 z-[var(--z-dropdown)] flex flex-col bg-[var(--bg)] text-[var(--text-primary)]'>
      <DesktopTitleBarLane />
      <ChatHeader chatConfig={chatConfig} starCount={starCount} />

      <ChatMessageContainer
        messages={displayMessages}
        isLoading={isLoading}
        showScrollButton={showScrollButton}
        messagesContainerRef={attachMessagesContainer}
        messagesEndRef={messagesEndRef as RefObject<HTMLDivElement>}
        scrollToBottom={() => scrollToBottom({ behavior: 'smooth', force: true })}
        chatConfig={chatConfig}
      />

      <div className='relative p-3 pb-4 md:p-4 md:pb-6'>
        <div className='relative mx-auto max-w-3xl md:max-w-[748px]'>
          <ChatInput
            onSubmit={(value, files) => {
              void handleSendMessage(value, files)
            }}
            isStreaming={isStreamingResponse}
            onStopStreaming={() => stopStreaming(setMessages)}
          />
        </div>
      </div>
    </div>
  )
}
