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

  // Use the custom streaming hook
  const { isStreamingResponse, abortControllerRef, stopStreaming, handleStreamedResponse } =
    useChatStreaming()

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
  const handleSendMessage = async (messageParam?: string) => {
    const messageToSend = messageParam ?? inputValue
    if (!messageToSend.trim() || isLoading) return

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
        // Handle streaming response - pass the current userHasScrolled value
        await handleStreamedResponse(
          response,
          setMessages,
          setIsLoading,
          scrollToBottom,
          userHasScrolled
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
            onSubmit={(value) => {
              void handleSendMessage(value)
            }}
            isStreaming={isStreamingResponse}
            onStopStreaming={() => stopStreaming(setMessages)}
          />
        </div>
      </div>
    </div>
  )
}
