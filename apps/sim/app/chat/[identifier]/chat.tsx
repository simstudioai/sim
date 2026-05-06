'use client'

import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { noop } from '@/lib/core/utils/request'
import {
  ChatErrorState,
  ChatHeader,
  ChatInput,
  ChatLoadingState,
  type ChatMessage,
  ChatMessageContainer,
  EmailAuth,
  PasswordAuth,
  VoiceInterface,
} from '@/app/chat/components'
import { CHAT_ERROR_MESSAGES, CHAT_REQUEST_TIMEOUT_MS } from '@/app/chat/constants'
import { useAudioStreaming, useChatStreaming } from '@/app/chat/hooks'
import SSOAuth from '@/ee/sso/components/sso-auth'
import { useDeployedChatConfig } from '@/hooks/queries/chats'
import { useGitHubStars } from '@/hooks/queries/github-stars'
import { useVoiceSettings } from '@/hooks/queries/voice-settings'

const logger = createLogger('ChatClient')

interface AudioStreamingOptions {
  voiceId: string
  chatId: string
  onError: (error: Error) => void
}

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

const DEFAULT_VOICE_SETTINGS = {
  voiceId: 'EXAVITQu4vr4xnSDxMaL', // Default ElevenLabs voice (Bella)
}

/**
 * Converts a File object to a base64 data URL
 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/**
 * Creates an audio stream handler for text-to-speech conversion
 * @param streamTextToAudio - Function to stream text to audio
 * @param voiceId - The voice ID to use for TTS
 * @param chatId - Optional chat ID for deployed chat authentication
 * @returns Audio stream handler function or undefined
 */
function createAudioStreamHandler(
  streamTextToAudio: (text: string, options: AudioStreamingOptions) => Promise<void>,
  voiceId: string,
  chatId: string
) {
  return async (text: string) => {
    try {
      await streamTextToAudio(text, {
        voiceId,
        chatId,
        onError: (error: Error) => {
          logger.error('Audio streaming error:', error)
        },
      })
    } catch (error) {
      logger.error('TTS error:', error)
    }
  }
}

export default function ChatClient({ identifier }: { identifier: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const [conversationId] = useState(() => generateId())

  const [showScrollButton, setShowScrollButton] = useState(false)
  const [userHasScrolled, setUserHasScrolled] = useState(false)
  const isUserScrollingRef = useRef(false)

  const [isVoiceFirstMode, setIsVoiceFirstMode] = useState(false)

  const { data: chatConfigResult, error: chatConfigError } = useDeployedChatConfig(identifier)
  const { data: voiceSettings } = useVoiceSettings()
  const { data: starCount } = useGitHubStars()

  const sttAvailable = voiceSettings?.sttAvailable === true
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
  const audioContextRef = useRef<AudioContext | null>(null)
  const { isPlayingAudio, streamTextToAudio, stopAudio } = useAudioStreaming(audioContextRef)

  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [])

  const scrollToMessage = useCallback(
    (messageId: string, scrollToShowOnlyMessage = false) => {
      const messageElement = document.querySelector(`[data-message-id="${messageId}"]`)
      if (messageElement && messagesContainerRef.current) {
        const container = messagesContainerRef.current
        const containerRect = container.getBoundingClientRect()
        const messageRect = messageElement.getBoundingClientRect()

        if (scrollToShowOnlyMessage) {
          const scrollTop = container.scrollTop + messageRect.top - containerRect.top

          container.scrollTo({
            top: scrollTop,
            behavior: 'smooth',
          })
        } else {
          const scrollTop = container.scrollTop + messageRect.top - containerRect.top - 80

          container.scrollTo({
            top: scrollTop,
            behavior: 'smooth',
          })
        }
      }
    },
    [messagesContainerRef]
  )

  const isStreamingResponseRef = useRef(isStreamingResponse)
  isStreamingResponseRef.current = isStreamingResponse

  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight
      setShowScrollButton(distanceFromBottom > 100)

      if (isStreamingResponseRef.current && !isUserScrollingRef.current) {
        setUserHasScrolled(true)
      }
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [chatConfig, isVoiceFirstMode, authRequired])

  useEffect(() => {
    if (isStreamingResponse) {
      setUserHasScrolled(false)

      isUserScrollingRef.current = true
      setTimeout(() => {
        isUserScrollingRef.current = false
      }, 1000)
    }
  }, [isStreamingResponse])

  const handleSendMessage = async (
    messageParam?: string,
    isVoiceInput = false,
    files?: Array<{
      id: string
      name: string
      size: number
      type: string
      file: File
      dataUrl?: string
    }>
  ) => {
    const messageToSend = messageParam ?? inputValue
    if ((!messageToSend.trim() && (!files || files.length === 0)) || isLoading) return

    logger.info('Sending message:', {
      messageToSend,
      isVoiceInput,
      conversationId,
      filesCount: files?.length,
    })

    setUserHasScrolled(false)

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
    setInputValue('')
    setIsLoading(true)

    setTimeout(() => {
      scrollToMessage(userMessage.id, true)
    }, 100)

    const abortController = new AbortController()
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

      const shouldPlayAudio = isVoiceInput || isVoiceFirstMode
      const audioHandler =
        shouldPlayAudio && chatConfig?.id
          ? createAudioStreamHandler(
              streamTextToAudio,
              DEFAULT_VOICE_SETTINGS.voiceId,
              chatConfig.id
            )
          : undefined

      logger.info('Starting to handle streamed response:', { shouldPlayAudio })

      await handleStreamedResponse(
        response,
        setMessages,
        setIsLoading,
        scrollToBottom,
        userHasScrolled,
        {
          voiceSettings: {
            isVoiceEnabled: shouldPlayAudio,
            voiceId: DEFAULT_VOICE_SETTINGS.voiceId,
            autoPlayResponses: shouldPlayAudio,
          },
          audioStreamHandler: audioHandler,
          outputConfigs: chatConfig?.outputConfigs,
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

  useEffect(() => {
    return () => {
      stopAudio()
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close()
      }
    }
  }, [stopAudio])

  const handleVoiceInterruption = useCallback(() => {
    stopAudio()

    if (isStreamingResponse) {
      stopStreaming(setMessages)
    }
  }, [isStreamingResponse, stopStreaming, setMessages, stopAudio])

  const handleVoiceStart = useCallback(() => {
    if (!sttAvailable) return
    setIsVoiceFirstMode(true)
  }, [sttAvailable])

  const handleExitVoiceMode = useCallback(() => {
    setIsVoiceFirstMode(false)
    stopAudio()
  }, [stopAudio])

  const handleVoiceTranscript = useCallback(
    (transcript: string) => {
      logger.info('Received voice transcript:', transcript)
      handleSendMessage(transcript, true)
    },
    [handleSendMessage]
  )

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

  if (isVoiceFirstMode) {
    return (
      <VoiceInterface
        onCallEnd={handleExitVoiceMode}
        onVoiceTranscript={handleVoiceTranscript}
        onVoiceStart={noop}
        onVoiceEnd={noop}
        onInterrupt={handleVoiceInterruption}
        isStreaming={isStreamingResponse}
        isPlayingAudio={isPlayingAudio}
        audioContextRef={audioContextRef}
        chatId={chatConfig?.id}
        messages={displayMessages.map((msg) => ({
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          type: msg.type,
        }))}
      />
    )
  }

  return (
    <div className='dark fixed inset-0 z-[100] flex flex-col bg-[var(--landing-bg)] text-[var(--landing-text)]'>
      {/* Header component */}
      <ChatHeader chatConfig={chatConfig} starCount={starCount} />

      {/* Message Container component */}
      <ChatMessageContainer
        messages={displayMessages}
        isLoading={isLoading}
        showScrollButton={showScrollButton}
        messagesContainerRef={messagesContainerRef as RefObject<HTMLDivElement>}
        messagesEndRef={messagesEndRef as RefObject<HTMLDivElement>}
        scrollToBottom={scrollToBottom}
        scrollToMessage={scrollToMessage}
        chatConfig={chatConfig}
      />

      {/* Input area (free-standing at the bottom) */}
      <div className='relative p-3 pb-4 md:p-4 md:pb-6'>
        <div className='relative mx-auto max-w-3xl md:max-w-[748px]'>
          <ChatInput
            onSubmit={(value, isVoiceInput, files) => {
              void handleSendMessage(value, isVoiceInput, files)
            }}
            isStreaming={isStreamingResponse}
            onStopStreaming={() => stopStreaming(setMessages)}
            onVoiceStart={handleVoiceStart}
            sttAvailable={sttAvailable}
          />
        </div>
      </div>
    </div>
  )
}
