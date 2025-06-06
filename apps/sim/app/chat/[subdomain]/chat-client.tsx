'use client'

import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console-logger'
import { getFormattedGitHubStars } from '@/app/(landing)/actions/github'
import EmailAuth from './components/auth/email/email-auth'
import PasswordAuth from './components/auth/password/password-auth'
import { ChatErrorState } from './components/error-state/error-state'
import { ChatHeader } from './components/header/header'
import { ChatInput } from './components/input/input'
import { ChatLoadingState } from './components/loading-state/loading-state'
import type { ChatMessage } from './components/message/message'
import { ChatMessageContainer } from './components/message-container/message-container'
import { VoiceInterface } from './components/voice-interface/voice-interface'
import { useAudioStreaming } from './hooks/use-audio-streaming'
import { useChatStreaming } from './hooks/use-chat-streaming'

const logger = createLogger('ChatClient')

interface ChatConfig {
  id: string
  title: string
  description: string
  customizations: {
    primaryColor?: string
    logoUrl?: string
    welcomeMessage?: string
    headerText?: string
  }
  authType?: 'public' | 'password' | 'email'
}

// Default voice settings since voice is now enabled by default
const DEFAULT_VOICE_SETTINGS = {
  isVoiceEnabled: true,
  voiceId: 'EXAVITQu4vr4xnSDxMaL', // Default ElevenLabs voice (Bella)
  autoPlayResponses: true,
  autoTriggerVoice: true,
  voiceFirstMode: false, // Keep standard chat interface by default
  textStreamingInVoiceMode: 'synced' as const,
  conversationMode: true,
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

export default function ChatClient({ subdomain }: { subdomain: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [chatConfig, setChatConfig] = useState<ChatConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const [starCount, setStarCount] = useState('3.4k')
  const [conversationId, setConversationId] = useState('')

  // Simple state for showing scroll button
  const [showScrollButton, setShowScrollButton] = useState(false)

  // Track if user has manually scrolled during response
  const [userHasScrolled, setUserHasScrolled] = useState(false)
  const isUserScrollingRef = useRef(false)

  // Authentication state
  const [authRequired, setAuthRequired] = useState<'password' | 'email' | null>(null)

  // Track if last message was voice input
  const [wasLastMessageVoice, setWasLastMessageVoice] = useState(false)

  // Voice-first mode state
  const [isVoiceFirstMode, setIsVoiceFirstMode] = useState(false)

  // Use the custom streaming hook
  const { isStreamingResponse, abortControllerRef, stopStreaming, handleStreamedResponse } =
    useChatStreaming()

  // Audio streaming hook
  const { isPlayingAudio, streamTextToAudio, stopAudio } = useAudioStreaming()

  // Track TTS failures
  const ttsFailureCountRef = useRef(0)
  const [ttsDisabled, setTtsDisabled] = useState(false)

  // Track last audio end time for conversational flow
  const lastAudioEndTimeRef = useRef<number>(0)
  const conversationTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Ref to store the reset interruption function from voice-first interface
  const resetInterruptionRef = useRef<(() => void) | null>(null)

  // Voice is always ready since server handles API key
  const isVoiceReady = DEFAULT_VOICE_SETTINGS.isVoiceEnabled

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

      // Track if user is manually scrolling during streaming
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

  // Reset user scroll tracking when streaming starts
  useEffect(() => {
    if (isStreamingResponse) {
      // Reset userHasScrolled when streaming starts
      setUserHasScrolled(false)

      // Give a small delay to distinguish between programmatic scroll and user scroll
      isUserScrollingRef.current = true
      setTimeout(() => {
        isUserScrollingRef.current = false
      }, 1000)
    }
  }, [isStreamingResponse])

  // Enhanced auto voice trigger for conversation mode
  useEffect(() => {
    if (
      isVoiceFirstMode &&
      DEFAULT_VOICE_SETTINGS.conversationMode &&
      !isLoading &&
      !isStreamingResponse &&
      !isPlayingAudio &&
      messages.length > 1 && // Ensure we have at least one exchange
      messages[messages.length - 1].type === 'assistant' // Last message is from assistant
    ) {
      // Clear any existing timeout
      if (conversationTimeoutRef.current) {
        clearTimeout(conversationTimeoutRef.current)
      }

      // Auto-start voice input after audio ends with a short delay
      conversationTimeoutRef.current = setTimeout(() => {
        // Only trigger if the user hasn't started typing or interacting
        if (!inputValue.trim()) {
          // This would need to be implemented in the ChatInput component
          // For now, we'll dispatch a custom event
          window.dispatchEvent(new CustomEvent('auto-trigger-voice'))
        }
      }, 800) // Shorter delay for more natural conversation

      return () => {
        if (conversationTimeoutRef.current) {
          clearTimeout(conversationTimeoutRef.current)
        }
      }
    }
  }, [
    isVoiceFirstMode,
    DEFAULT_VOICE_SETTINGS.conversationMode,
    isLoading,
    isStreamingResponse,
    isPlayingAudio,
    messages,
    inputValue,
  ])

  // Enhanced audio end tracking for conversation flow
  useEffect(() => {
    if (!isPlayingAudio && lastAudioEndTimeRef.current !== 0) {
      // Audio just ended
      lastAudioEndTimeRef.current = Date.now()
    }
  }, [isPlayingAudio])

  const fetchChatConfig = async () => {
    try {
      const response = await fetch(`/api/chat/${subdomain}`, {
        credentials: 'same-origin',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
        },
      })

      if (!response.ok) {
        // Check if auth is required
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
        }

        throw new Error(`Failed to load chat configuration: ${response.status}`)
      }

      // Reset auth required state when authentication is successful
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
      setError('This chat is currently unavailable. Please try again later.')
    }
  }

  // Fetch chat config on mount and generate new conversation ID
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
  }, [subdomain])

  const refreshChat = () => {
    fetchChatConfig()
  }

  const handleAuthSuccess = () => {
    setAuthRequired(null)
    setTimeout(() => {
      refreshChat()
    }, 800)
  }

  // Handle sending a message
  const handleSendMessage = async (messageParam?: string, isVoiceInput = false) => {
    const messageToSend = messageParam ?? inputValue
    if (!messageToSend.trim() || isLoading) return

    // Track if this was a voice message
    setWasLastMessageVoice(isVoiceInput)

    // Reset userHasScrolled when sending a new message
    setUserHasScrolled(false)

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      content: messageToSend,
      type: 'user',
      timestamp: new Date(),
    }

    // Add the user's message to the chat
    setMessages((prev) => [...prev, userMessage])
    setInputValue('')
    setIsLoading(true)

    // Scroll to show only the user's message and loading indicator
    setTimeout(() => {
      scrollToMessage(userMessage.id, true)
    }, 100)

    try {
      // Send structured payload to maintain chat context
      const payload = {
        message: userMessage.content,
        conversationId,
      }

      // Create a new AbortController for this request
      abortControllerRef.current = new AbortController()

      // Use relative URL with credentials
      const response = await fetch(`/api/chat/${subdomain}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify(payload),
        signal: abortControllerRef.current.signal,
      })

      if (!response.ok) {
        throw new Error('Failed to get response')
      }

      // Detect streaming response via content-type (text/plain) or absence of JSON content-type
      const contentType = response.headers.get('Content-Type') || ''

      if (contentType.includes('text/plain')) {
        // Prepare audio streaming handler if voice mode is enabled
        // Play audio if: voice input was used OR (in voice-first mode with auto-play enabled)
        const shouldPlayAudio =
          isVoiceReady &&
          !ttsDisabled &&
          (isVoiceInput || (isVoiceFirstMode && DEFAULT_VOICE_SETTINGS.autoPlayResponses))

        const audioStreamHandler = shouldPlayAudio
          ? async (text: string) => {
              try {
                await streamTextToAudio(text, {
                  voiceId: DEFAULT_VOICE_SETTINGS.voiceId,
                  // Use optimized streaming for conversation mode
                  onAudioStart: () => {
                    lastAudioEndTimeRef.current = 0 // Reset end time
                  },
                  onAudioEnd: () => {
                    lastAudioEndTimeRef.current = Date.now()
                  },
                  onAudioChunkStart: () => {
                    // Reset interruption flag for each new audio chunk to allow multiple interruptions
                    // Reset the interruption flag in the voice interface
                    if (resetInterruptionRef.current) {
                      resetInterruptionRef.current()
                    }
                  },
                  onError: (error) => {
                    logger.error('Audio streaming error:', error)
                    // Disable TTS on authentication errors
                    if (error.message.includes('401')) {
                      ttsFailureCountRef.current++
                      if (ttsFailureCountRef.current >= 3) {
                        logger.warn('Disabling TTS due to repeated authentication failures')
                        setTtsDisabled(true)
                      }
                    }
                  },
                })
                // Reset failure count on success
                ttsFailureCountRef.current = 0
              } catch (error) {
                logger.error('TTS error:', error)
              }
            }
          : undefined

        // Handle streaming response with audio support
        await handleStreamedResponse(
          response,
          setMessages,
          setIsLoading,
          scrollToBottom,
          userHasScrolled,
          {
            voiceSettings: {
              isVoiceEnabled: DEFAULT_VOICE_SETTINGS.isVoiceEnabled,
              voiceId: DEFAULT_VOICE_SETTINGS.voiceId,
              autoPlayResponses:
                isVoiceInput || (isVoiceFirstMode && DEFAULT_VOICE_SETTINGS.autoPlayResponses),
              voiceFirstMode: isVoiceFirstMode,
              textStreamingInVoiceMode: DEFAULT_VOICE_SETTINGS.textStreamingInVoiceMode,
              conversationMode: isVoiceFirstMode ? DEFAULT_VOICE_SETTINGS.conversationMode : false,
            },
            audioStreamHandler,
            onAudioStart: () => {
              lastAudioEndTimeRef.current = 0
            },
            onAudioEnd: () => {
              lastAudioEndTimeRef.current = Date.now()
            },
          }
        )
      } else {
        // Fallback to JSON response handling
        const responseData = await response.json()
        logger.info('Message response:', responseData)

        // Handle different response formats from API
        if (
          responseData.multipleOutputs &&
          responseData.contents &&
          Array.isArray(responseData.contents)
        ) {
          // For multiple outputs, create separate assistant messages for each
          const assistantMessages = responseData.contents.map((content: any) => {
            // Format the content appropriately
            let formattedContent = content

            // Convert objects to strings for display
            if (typeof formattedContent === 'object' && formattedContent !== null) {
              try {
                formattedContent = JSON.stringify(formattedContent)
              } catch (_e) {
                formattedContent = 'Received structured data response'
              }
            }

            return {
              id: crypto.randomUUID(),
              content: formattedContent || 'No content found',
              type: 'assistant' as const,
              timestamp: new Date(),
            }
          })

          // Add all messages at once
          setMessages((prev) => [...prev, ...assistantMessages])

          // Play audio for the full response if voice mode is enabled
          // Play audio if: voice input was used OR (in voice-first mode with auto-play enabled)
          if (
            isVoiceReady &&
            !ttsDisabled &&
            (isVoiceInput || (isVoiceFirstMode && DEFAULT_VOICE_SETTINGS.autoPlayResponses))
          ) {
            const fullContent = assistantMessages.map((m: ChatMessage) => m.content).join(' ')
            if (fullContent.trim()) {
              try {
                await streamTextToAudio(fullContent, {
                  voiceId: DEFAULT_VOICE_SETTINGS.voiceId,
                  onAudioStart: () => {
                    lastAudioEndTimeRef.current = 0
                  },
                  onAudioEnd: () => {
                    lastAudioEndTimeRef.current = Date.now()
                  },
                  onError: (error) => {
                    logger.error('Audio playback error:', error)
                    // Disable TTS on authentication errors
                    if (error.message.includes('401')) {
                      ttsFailureCountRef.current++
                      if (ttsFailureCountRef.current >= 3) {
                        logger.warn('Disabling TTS due to repeated authentication failures')
                        setTtsDisabled(true)
                      }
                    }
                  },
                })
                // Reset failure count on success
                ttsFailureCountRef.current = 0
              } catch (error) {
                logger.error('TTS error:', error)
              }
            }
          }
        } else {
          // Handle single output as before
          let messageContent = responseData.output

          if (!messageContent && responseData.content) {
            if (typeof responseData.content === 'object') {
              if (responseData.content.text) {
                messageContent = responseData.content.text
              } else {
                try {
                  messageContent = JSON.stringify(responseData.content)
                } catch (_e) {
                  messageContent = 'Received structured data response'
                }
              }
            } else {
              messageContent = responseData.content
            }
          }

          const assistantMessage: ChatMessage = {
            id: crypto.randomUUID(),
            content: messageContent || "Sorry, I couldn't process your request.",
            type: 'assistant',
            timestamp: new Date(),
          }

          setMessages((prev) => [...prev, assistantMessage])

          // Play audio for the response if voice mode is enabled
          // Play audio if: voice input was used OR (in voice-first mode with auto-play enabled)
          if (
            isVoiceReady &&
            !ttsDisabled &&
            (isVoiceInput || (isVoiceFirstMode && DEFAULT_VOICE_SETTINGS.autoPlayResponses)) &&
            assistantMessage.content
          ) {
            const contentString =
              typeof assistantMessage.content === 'string'
                ? assistantMessage.content
                : JSON.stringify(assistantMessage.content)

            try {
              await streamTextToAudio(contentString, {
                voiceId: DEFAULT_VOICE_SETTINGS.voiceId,
                onAudioStart: () => {
                  lastAudioEndTimeRef.current = 0
                },
                onAudioEnd: () => {
                  lastAudioEndTimeRef.current = Date.now()
                },
                onError: (error) => {
                  logger.error('Audio playback error:', error)
                  // Disable TTS on authentication errors
                  if (error.message.includes('401')) {
                    ttsFailureCountRef.current++
                    if (ttsFailureCountRef.current >= 3) {
                      logger.warn('Disabling TTS due to repeated authentication failures')
                      setTtsDisabled(true)
                    }
                  }
                },
              })
              // Reset failure count on success
              ttsFailureCountRef.current = 0
            } catch (error) {
              logger.error('TTS error:', error)
            }
          }
        }
      }
    } catch (error) {
      logger.error('Error sending message:', error)

      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        content: 'Sorry, there was an error processing your message. Please try again.',
        type: 'assistant',
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  // Stop audio when component unmounts or when streaming is stopped
  useEffect(() => {
    return () => {
      stopAudio()
    }
  }, [stopAudio])

  // Voice interruption - stop audio when user starts speaking
  const handleVoiceInterruption = useCallback(() => {
    // 1. Always stop audio playback immediately (even if play event hasn't fired yet)
    stopAudio()

    // 2. Stop any ongoing streaming response
    if (isStreamingResponse) {
      stopStreaming(setMessages)
    }

    // 3. Add a clear visual indicator of interruption
    setMessages((prev) => {
      const lastMessage = prev[prev.length - 1]

      // If the last message is from assistant and was being streamed/played
      if (lastMessage && lastMessage.type === 'assistant' && !lastMessage.isInitialMessage) {
        return [
          ...prev.slice(0, -1),
          {
            ...lastMessage,
            content: `${lastMessage.content}\n\n_[Interrupted by user]_`,
            isStreaming: false,
          },
        ]
      }

      return prev
    })
  }, [isStreamingResponse, stopStreaming, setMessages, stopAudio])

  // Handle voice mode activation with smooth transition
  const handleVoiceStart = useCallback(() => {
    setIsVoiceFirstMode(true)
  }, [])

  // Handle exiting voice mode with smooth transition
  const handleExitVoiceMode = useCallback(() => {
    setIsVoiceFirstMode(false)
    stopAudio() // Stop any playing audio when exiting

    // Clear any conversation mode timeouts
    if (conversationTimeoutRef.current) {
      clearTimeout(conversationTimeoutRef.current)
      conversationTimeoutRef.current = null
    }
  }, [stopAudio])

  // Handle voice transcript from voice-first interface
  const handleVoiceTranscript = useCallback(
    (transcript: string) => {
      handleSendMessage(transcript, true)
    },
    [handleSendMessage]
  )

  // If error, show error message using the extracted component
  if (error) {
    return <ChatErrorState error={error} starCount={starCount} />
  }

  // If authentication is required, use the extracted components
  if (authRequired) {
    // Get title and description from the URL params or use defaults
    const title = new URLSearchParams(window.location.search).get('title') || 'chat'
    const primaryColor = new URLSearchParams(window.location.search).get('color') || '#802FFF'

    if (authRequired === 'password') {
      return (
        <PasswordAuth
          subdomain={subdomain}
          onAuthSuccess={handleAuthSuccess}
          title={title}
          primaryColor={primaryColor}
        />
      )
    }
    if (authRequired === 'email') {
      return (
        <EmailAuth
          subdomain={subdomain}
          onAuthSuccess={handleAuthSuccess}
          title={title}
          primaryColor={primaryColor}
        />
      )
    }
  }

  // Loading state while fetching config using the extracted component
  if (!chatConfig) {
    return <ChatLoadingState />
  }

  // Voice-first mode interface with smooth transition
  if (isVoiceFirstMode && isVoiceReady) {
    return (
      <VoiceInterface
        onCallEnd={handleExitVoiceMode}
        onVoiceTranscript={handleVoiceTranscript}
        onVoiceStart={() => logger.info('🎙️ Voice started in voice-first mode')}
        onVoiceEnd={() => logger.info('🔇 Voice ended in voice-first mode')}
        onInterrupt={handleVoiceInterruption}
        onAudioChunkStart={() => {
          // Reset interruption flag for each new audio chunk to allow multiple interruptions
          logger.info('🔄 New audio chunk starting - resetting interruption flag')
          // Reset the interruption flag in the voice interface
          if (resetInterruptionRef.current) {
            resetInterruptionRef.current()
          }
        }}
        onResetInterruption={(resetFn) => {
          // Store the reset function so we can call it from audio chunk callbacks
          resetInterruptionRef.current = resetFn
        }}
        isStreaming={isStreamingResponse}
        isPlayingAudio={isPlayingAudio}
        messages={messages.map((msg) => ({
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          type: msg.type,
        }))}
      />
    )
  }

  // Standard text-based chat interface
  return (
    <div className='fixed inset-0 z-[100] flex flex-col bg-background'>
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
      <div className='relative p-4 pb-6'>
        <div className='relative mx-auto max-w-3xl'>
          <ChatInput
            onSubmit={(value, isVoiceInput) => {
              void handleSendMessage(value, isVoiceInput)
            }}
            isStreaming={isStreamingResponse}
            onStopStreaming={() => stopStreaming(setMessages)}
            onVoiceStart={handleVoiceStart}
            onInterrupt={handleVoiceInterruption}
          />
        </div>
      </div>
    </div>
  )
}
