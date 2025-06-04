'use client'

import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { getFormattedGitHubStars } from '@/app/(landing)/actions/github'
import EmailAuth from './components/auth/email/email-auth'
import PasswordAuth from './components/auth/password/password-auth'
import { ChatErrorState } from './components/error-state/error-state'
import { ChatHeader } from './components/header/header'
import { ChatInput } from './components/input/input'
import { ChatLoadingState } from './components/loading-state/loading-state'
import type { ChatMessage } from './components/message/message'
import { ChatMessageContainer } from './components/message-container/message-container'
import { useAudioStreaming } from './hooks/use-audio-streaming'
import { useChatStreaming } from './hooks/use-chat-streaming'

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
          console.log('🎙️ Conversation mode: Auto-triggering voice input...')
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
      console.error('Error fetching chat config:', error)
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
        console.error('Failed to fetch GitHub stars:', err)
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
        // Only auto-play audio if we're in voice-first mode AND (voice input was used OR auto-play is enabled)
        const shouldPlayAudio =
          isVoiceFirstMode &&
          isVoiceReady &&
          (isVoiceInput || DEFAULT_VOICE_SETTINGS.autoPlayResponses) &&
          !ttsDisabled

        const audioStreamHandler = shouldPlayAudio
          ? async (text: string) => {
              try {
                await streamTextToAudio(text, {
                  voiceId: DEFAULT_VOICE_SETTINGS.voiceId,
                  // Use optimized streaming for conversation mode
                  useOptimizedStreaming: DEFAULT_VOICE_SETTINGS.conversationMode,
                  onAudioStart: () => {
                    console.log('🔊 Audio streaming started')
                    lastAudioEndTimeRef.current = 0 // Reset end time
                  },
                  onAudioEnd: () => {
                    console.log('🔇 Audio streaming ended')
                    lastAudioEndTimeRef.current = Date.now()
                  },
                  onError: (error) => {
                    console.error('Audio streaming error:', error)
                    // Disable TTS on authentication errors
                    if (error.message.includes('401')) {
                      ttsFailureCountRef.current++
                      if (ttsFailureCountRef.current >= 3) {
                        console.warn('Disabling TTS due to repeated authentication failures')
                        setTtsDisabled(true)
                      }
                    }
                  },
                })
                // Reset failure count on success
                ttsFailureCountRef.current = 0
              } catch (error) {
                console.error('TTS error:', error)
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
              autoPlayResponses: isVoiceFirstMode
                ? DEFAULT_VOICE_SETTINGS.autoPlayResponses
                : false,
              voiceFirstMode: isVoiceFirstMode,
              textStreamingInVoiceMode: DEFAULT_VOICE_SETTINGS.textStreamingInVoiceMode,
              conversationMode: isVoiceFirstMode ? DEFAULT_VOICE_SETTINGS.conversationMode : false,
            },
            audioStreamHandler,
            onAudioStart: () => {
              console.log('🔊 Audio streaming started')
              lastAudioEndTimeRef.current = 0
            },
            onAudioEnd: () => {
              console.log('🔇 Audio streaming ended')
              lastAudioEndTimeRef.current = Date.now()
            },
          }
        )
      } else {
        // Fallback to JSON response handling
        const responseData = await response.json()
        console.log('Message response:', responseData)

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
          // Only auto-play if we're in voice-first mode AND (voice input was used OR auto-play is enabled)
          if (
            isVoiceFirstMode &&
            isVoiceReady &&
            (isVoiceInput || DEFAULT_VOICE_SETTINGS.autoPlayResponses) &&
            !ttsDisabled
          ) {
            const fullContent = assistantMessages.map((m: ChatMessage) => m.content).join(' ')
            if (fullContent.trim()) {
              try {
                await streamTextToAudio(fullContent, {
                  voiceId: DEFAULT_VOICE_SETTINGS.voiceId,
                  // Use optimized streaming for conversation mode
                  useOptimizedStreaming: DEFAULT_VOICE_SETTINGS.conversationMode,
                  onAudioStart: () => {
                    console.log('🔊 Audio streaming started')
                    lastAudioEndTimeRef.current = 0
                  },
                  onAudioEnd: () => {
                    console.log('🔇 Audio streaming ended')
                    lastAudioEndTimeRef.current = Date.now()
                  },
                  onError: (error) => {
                    console.error('Audio playback error:', error)
                    // Disable TTS on authentication errors
                    if (error.message.includes('401')) {
                      ttsFailureCountRef.current++
                      if (ttsFailureCountRef.current >= 3) {
                        console.warn('Disabling TTS due to repeated authentication failures')
                        setTtsDisabled(true)
                      }
                    }
                  },
                })
                // Reset failure count on success
                ttsFailureCountRef.current = 0
              } catch (error) {
                console.error('TTS error:', error)
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
          // Only auto-play if we're in voice-first mode AND (voice input was used OR auto-play is enabled)
          if (
            isVoiceFirstMode &&
            isVoiceReady &&
            (isVoiceInput || DEFAULT_VOICE_SETTINGS.autoPlayResponses) &&
            assistantMessage.content &&
            !ttsDisabled
          ) {
            const contentString =
              typeof assistantMessage.content === 'string'
                ? assistantMessage.content
                : JSON.stringify(assistantMessage.content)

            try {
              await streamTextToAudio(contentString, {
                voiceId: DEFAULT_VOICE_SETTINGS.voiceId,
                // Use optimized streaming for conversation mode
                useOptimizedStreaming: DEFAULT_VOICE_SETTINGS.conversationMode,
                onAudioStart: () => {
                  console.log('🔊 Audio streaming started')
                  lastAudioEndTimeRef.current = 0
                },
                onAudioEnd: () => {
                  console.log('🔇 Audio streaming ended')
                  lastAudioEndTimeRef.current = Date.now()
                },
                onError: (error) => {
                  console.error('Audio playback error:', error)
                  // Disable TTS on authentication errors
                  if (error.message.includes('401')) {
                    ttsFailureCountRef.current++
                    if (ttsFailureCountRef.current >= 3) {
                      console.warn('Disabling TTS due to repeated authentication failures')
                      setTtsDisabled(true)
                    }
                  }
                },
              })
              // Reset failure count on success
              ttsFailureCountRef.current = 0
            } catch (error) {
              console.error('TTS error:', error)
            }
          }
        }
      }
    } catch (error) {
      console.error('Error sending message:', error)

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
    if (isPlayingAudio) {
      console.log('🛑 Voice interruption detected, stopping audio...')
      stopAudio()
    }
  }, [isPlayingAudio, stopAudio])

  // Handle voice mode activation
  const handleVoiceStart = useCallback(() => {
    setIsVoiceFirstMode(true)
  }, [])

  // Handle exiting voice mode
  const handleExitVoiceMode = useCallback(() => {
    setIsVoiceFirstMode(false)
    stopAudio() // Stop any playing audio when exiting

    // Clear any conversation mode timeouts
    if (conversationTimeoutRef.current) {
      clearTimeout(conversationTimeoutRef.current)
      conversationTimeoutRef.current = null
    }
  }, [stopAudio])

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

  // Voice-first mode interface
  if (isVoiceFirstMode && isVoiceReady) {
    return (
      <div className='fixed inset-0 z-[100] flex flex-col bg-gray-900'>
        {/* Main Voice Interface */}
        <div className='flex flex-1 flex-col items-center justify-center px-8'>
          {/* Gradient Blue Orb */}
          <div className='relative mb-16'>
            <div
              className={`relative h-80 w-80 rounded-full transition-all duration-500 ease-out ${
                isPlayingAudio
                  ? 'scale-110 bg-gradient-to-br from-blue-300 via-blue-400 to-blue-600 shadow-2xl shadow-blue-500/50'
                  : isStreamingResponse
                    ? 'scale-105 animate-pulse bg-gradient-to-br from-blue-400 via-blue-500 to-blue-700 shadow-blue-600/40 shadow-xl'
                    : 'bg-gradient-to-br from-blue-200 via-blue-400 to-blue-600 shadow-blue-400/30 shadow-lg'
              } `}
            >
              {/* Animated rings when speaking */}
              {isPlayingAudio && (
                <>
                  <div className='absolute inset-0 animate-ping rounded-full bg-gradient-to-br from-blue-300 to-blue-500 opacity-20' />
                  <div
                    className='absolute inset-4 animate-ping rounded-full bg-gradient-to-br from-blue-200 to-blue-400 opacity-30'
                    style={{ animationDelay: '0.2s' }}
                  />
                  <div
                    className='absolute inset-8 animate-ping rounded-full bg-gradient-to-br from-blue-100 to-blue-300 opacity-40'
                    style={{ animationDelay: '0.4s' }}
                  />
                </>
              )}

              {/* Subtle inner glow */}
              <div className='absolute inset-4 rounded-full bg-gradient-to-br from-white/20 to-transparent' />

              {/* Optional center content for different states */}
              {isStreamingResponse && (
                <div className='absolute inset-0 flex items-center justify-center'>
                  <div className='h-16 w-16 animate-spin rounded-full border-4 border-white/30 border-t-white' />
                </div>
              )}
            </div>
          </div>

          {/* Current Message Display */}
          {messages.length > 0 && (
            <div className='mx-auto mb-12 max-w-2xl px-6'>
              {(() => {
                const latestMessage = messages[messages.length - 1]
                if (!latestMessage) return null

                return (
                  <div className='text-center'>
                    <p className='font-light text-white/90 text-xl leading-relaxed'>
                      {typeof latestMessage.content === 'string'
                        ? latestMessage.content
                        : JSON.stringify(latestMessage.content)}
                    </p>
                    {latestMessage.isStreaming && (
                      <div className='mt-4 flex items-center justify-center space-x-2'>
                        <div className='h-2 w-2 animate-pulse rounded-full bg-white/60' />
                        <div
                          className='h-2 w-2 animate-pulse rounded-full bg-white/60'
                          style={{ animationDelay: '0.2s' }}
                        />
                        <div
                          className='h-2 w-2 animate-pulse rounded-full bg-white/60'
                          style={{ animationDelay: '0.4s' }}
                        />
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>
          )}

          {/* Status Text */}
          <div className='mb-8 text-center text-white/60'>
            {isStreamingResponse ? (
              <p className='font-light text-lg'>Thinking...</p>
            ) : isPlayingAudio ? (
              <p className='font-light text-lg'>Speaking...</p>
            ) : (
              <p className='font-light text-lg'>Listening...</p>
            )}
          </div>
        </div>

        {/* Bottom Controls */}
        <div className='px-8 pb-12'>
          <div className='flex items-center justify-center space-x-12'>
            {/* Microphone Button */}
            <div className='flex items-center'>
              <ChatInput
                onSubmit={(value, isVoiceInput) => {
                  void handleSendMessage(value, isVoiceInput)
                }}
                isStreaming={isStreamingResponse}
                onStopStreaming={() => stopStreaming(setMessages)}
                onVoiceStart={handleVoiceInterruption}
                onInterrupt={handleVoiceInterruption}
                voiceOnly={true}
              />
            </div>

            {/* Exit Voice Mode Button */}
            <button
              onClick={handleExitVoiceMode}
              className='flex h-16 w-16 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-all duration-200 hover:bg-white/20'
              title='Exit voice mode'
            >
              <svg
                width='24'
                height='24'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
              >
                <path d='M18 6L6 18M6 6l12 12' strokeLinecap='round' strokeLinejoin='round' />
              </svg>
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Standard text-based chat interface (voice-first mode removed for simplicity)
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
