'use client'

import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { v4 as uuidv4 } from 'uuid'
import { noop } from '@/lib/core/utils/request'
import { getFormattedGitHubStars } from '@/app/(landing)/actions/github'
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

const logger = createLogger('ChatClient')

interface ChatConfig {
  id: string
  title: string
  description: string
  customizations: {
    primaryColor?: string
    logoUrl?: string
    imageUrl?: string
    welcomeMessage?: string
    headerText?: string
  }
  authType?: 'public' | 'password' | 'email' | 'sso'
  outputConfigs?: Array<{ blockId: string; path?: string }>
}

interface AudioStreamingOptions {
  voiceId: string
  chatId?: string
  onError: (error: Error) => void
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
  chatId?: string
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

function throttle<T extends (...args: any[]) => any>(func: T, delay: number): T {
  let timeoutId: NodeJS.Timeout | null = null
  let lastExecTime = 0

  return ((...args: Parameters<T>) => {
    const currentTime = Date.now()

    if (currentTime - lastExecTime > delay) {
      func(...args)
      lastExecTime = currentTime
    } else {
      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = setTimeout(
        () => {
          func(...args)
          lastExecTime = Date.now()
        },
        delay - (currentTime - lastExecTime)
      )
    }
  }) as T
}

export default function ChatClient({ identifier }: { identifier: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [chatConfig, setChatConfig] = useState<ChatConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const [starCount, setStarCount] = useState('25.8k')
  const [conversationId, setConversationId] = useState('')

  const [showScrollButton, setShowScrollButton] = useState(false)
  const [userHasScrolled, setUserHasScrolled] = useState(false)
  const isUserScrollingRef = useRef(false)

  const [authRequired, setAuthRequired] = useState<'password' | 'email' | 'sso' | null>(null)

  const [isVoiceFirstMode, setIsVoiceFirstMode] = useState(false)
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

  const handleScroll = useCallback(
    throttle(() => {
      const container = messagesContainerRef.current
      if (!container) return

      const { scrollTop, scrollHeight, clientHeight } = container
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight
      setShowScrollButton(distanceFromBottom > 100)

      if (isStreamingResponse && !isUserScrollingRef.current) {
        setUserHasScrolled(true)
      }
    }, 100),
    [isStreamingResponse]
  )

  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  useEffect(() => {
    if (isStreamingResponse) {
      setUserHasScrolled(false)

      isUserScrollingRef.current = true
      setTimeout(() => {
        isUserScrollingRef.current = false
      }, 1000)
    }
  }, [isStreamingResponse])

  const fetchChatConfig = async () => {
    try {
      const response = await fetch(`/api/chat/${identifier}`, {
        credentials: 'same-origin',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
        },
      })

      if (!response.ok) {
        if (response.status === 401) {
          const errorData = await response.json()

          if (errorData.error === 'auth_required_password') {
            setAuthRequired('password')
            return
          }
          if (errorData.error === 'auth_required_email') {
            setAuthRequired('email')
            return
          }
          if (errorData.error === 'auth_required_sso') {
            setAuthRequired('sso')
            return
          }
        }

        throw new Error(`Failed to load chat configuration: ${response.status}`)
      }

      setAuthRequired(null)

      const data = await response.json()

      setChatConfig(data)

      if (data?.customizations?.welcomeMessage) {
        setMessages([
          {
            id: 'welcome',
            content: data.customizations.welcomeMessage,
            type: 'assistant',
            timestamp: new Date(),
            isInitialMessage: true,
          },
        ])
      }
    } catch (error) {
      logger.error('Error fetching chat config:', error)
      setError(CHAT_ERROR_MESSAGES.CHAT_UNAVAILABLE)
    }
  }

  useEffect(() => {
    fetchChatConfig()
    setConversationId(uuidv4())

    getFormattedGitHubStars()
      .then((formattedStars) => {
        setStarCount(formattedStars)
      })
      .catch((err) => {
        logger.error('Failed to fetch GitHub stars:', err)
      })
  }, [identifier])

  const refreshChat = () => {
    fetchChatConfig()
  }

  const handleAuthSuccess = () => {
    setAuthRequired(null)
    setTimeout(() => {
      refreshChat()
    }, 800)
  }

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
      id: crypto.randomUUID(),
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
      const payload: any = {
        input:
          typeof userMessage.content === 'string'
            ? userMessage.content
            : JSON.stringify(userMessage.content),
        conversationId,
      }

      if (files && files.length > 0) {
        payload.files = await Promise.all(
          files.map(async (file) => ({
            name: file.name,
            size: file.size,
            type: file.type,
            data: file.dataUrl || (await fileToBase64(file.file)),
          }))
        )
      }

      logger.info('API payload:', {
        ...payload,
        files: payload.files ? `${payload.files.length} files` : undefined,
      })

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
      const audioHandler = shouldPlayAudio
        ? createAudioStreamHandler(
            streamTextToAudio,
            DEFAULT_VOICE_SETTINGS.voiceId,
            chatConfig?.id
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
    } catch (error: any) {
      clearTimeout(timeoutId)

      if (error.name === 'AbortError') {
        logger.info('Request aborted by user or timeout')
        setIsLoading(false)
        return
      }

      logger.error('Error sending message:', error)
      setIsLoading(false)
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
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
    setIsVoiceFirstMode(true)
  }, [])

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

  if (error) {
    return <ChatErrorState error={error} />
  }

  if (authRequired) {
    // const title = new URLSearchParams(window.location.search).get('title') || 'chat'
    // const primaryColor =
    //   new URLSearchParams(window.location.search).get('color') || 'var(--brand-primary-hover-hex)'

    if (authRequired === 'password') {
      return <PasswordAuth identifier={identifier} onAuthSuccess={handleAuthSuccess} />
    }
    if (authRequired === 'email') {
      return <EmailAuth identifier={identifier} onAuthSuccess={handleAuthSuccess} />
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
        messages={messages.map((msg) => ({
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          type: msg.type,
        }))}
      />
    )
  }

  return (
    <div className='fixed inset-0 z-[100] flex flex-col bg-white text-foreground'>
      {/* Header component */}
      <ChatHeader chatConfig={chatConfig} starCount={starCount} />

      {/* Message Container component */}
      <ChatMessageContainer
        messages={messages}
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
          />
        </div>
      </div>
    </div>
  )
}
