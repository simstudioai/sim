'use client'

import {
  Children,
  isValidElement,
  KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ArrowDown, ArrowUp, Loader2, Lock, Mail, Square } from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { OTPInputForm } from '@/components/ui/input-otp-form'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { getFormattedGitHubStars } from '@/app/(landing)/actions/github'
import HeaderLinks from './components/header-links/header-links'
import MarkdownRenderer from './components/markdown-renderer/markdown-renderer'

// Define message type
interface ChatMessage {
  id: string
  content: string
  type: 'user' | 'assistant'
  timestamp: Date
}

// Define chat config type
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

// ChatGPT-style message component
function ClientChatMessage({ message }: { message: ChatMessage }) {
  // Check if content is a JSON object
  const isJsonObject = useMemo(() => {
    return typeof message.content === 'object' && message.content !== null
  }, [message.content])

  // For user messages (on the right)
  if (message.type === 'user') {
    return (
      <div className="py-5 px-4" data-message-id={message.id}>
        <div className="max-w-3xl mx-auto">
          <div className="flex justify-end">
            <div className="bg-[#F4F4F4] dark:bg-gray-600 rounded-3xl max-w-[80%] py-3 px-4">
              <div className="whitespace-pre-wrap break-words text-base leading-relaxed text-[#0D0D0D]">
                {isJsonObject ? (
                  <pre>{JSON.stringify(message.content, null, 2)}</pre>
                ) : (
                  <span>{message.content}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // For assistant messages (on the left)
  return (
    <div className="py-5 px-4" data-message-id={message.id}>
      <div className="max-w-3xl mx-auto">
        <div className="flex">
          <div className="max-w-[80%]">
            <div className="whitespace-pre-wrap break-words text-base leading-relaxed">
              {isJsonObject ? (
                <pre>{JSON.stringify(message.content, null, 2)}</pre>
              ) : (
                <MarkdownRenderer content={message.content as string} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ChatClient({ subdomain }: { subdomain: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [chatConfig, setChatConfig] = useState<ChatConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [starCount, setStarCount] = useState('3.4k')
  const [conversationId, setConversationId] = useState('')
  
  // New ref to track the latest user message ID for scrolling
  const latestUserMessageIdRef = useRef<string | null>(null)
  
  // Add AbortController ref to stop streaming
  const abortControllerRef = useRef<AbortController | null>(null)
  
  // New state for container scroll behavior
  const [scrollBehavior, setScrollBehavior] = useState<'smooth' | 'auto'>('smooth')

  // Authentication state
  const [authRequired, setAuthRequired] = useState<'password' | 'email' | null>(null)
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [isAuthenticating, setIsAuthenticating] = useState(false)

  // OTP verification state
  const [showOtpVerification, setShowOtpVerification] = useState(false)
  const [otpValue, setOtpValue] = useState('')
  const [isSendingOtp, setIsSendingOtp] = useState(false)
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false)
  
  // Scroll and streaming state
  const [isStreamingResponse, setIsStreamingResponse] = useState(false)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const [hasScrolled, setHasScrolled] = useState(false)
  
  // Function to scroll to the bottom of the chat
  const scrollToBottom = () => {
    if (messagesEndRef.current && messagesContainerRef.current) {
      // Set behavior back to smooth for user-initiated scrolling
      setScrollBehavior('smooth')
      
      // Use scrollIntoView with block: 'end' to scroll to the bottom
      messagesEndRef.current.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'end' 
      })
    }
  }
  
  // Listen for scroll events to determine when to show scroll button
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return
    
    const handleScroll = () => {
      // Get scroll metrics
      const { scrollTop, scrollHeight, clientHeight } = container
      
      // Calculate scroll position - are we near the bottom?
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight
      const isNearBottom = distanceFromBottom < 100
      
      // Show button if not at the bottom (with some tolerance)
      setShowScrollButton(!isNearBottom)
      
      // Track if user has ever scrolled
      if (!hasScrolled && scrollTop > 0) {
        setHasScrolled(true)
      }
      
      // Log scroll position for debugging
      console.log('Scroll metrics:', {
        scrollTop,
        scrollHeight,
        clientHeight,
        distanceFromBottom,
        isNearBottom,
        showButton: !isNearBottom
      })
    }
    
    container.addEventListener('scroll', handleScroll, { passive: true })
    
    // Initial check
    handleScroll()
    
    // Also recheck when messages change or streaming state changes
    // This ensures button appears properly after new content is added
    if (messages.length > 0) {
      handleScroll()
    }
    
    return () => container.removeEventListener('scroll', handleScroll)
  }, [hasScrolled, messages, isStreamingResponse])

  // Scroll to bottom when new messages are added
  useEffect(() => {
    // Only scroll to bottom if we're not streaming a response
    if (messages.length > 0 && !isStreamingResponse) {
      scrollToBottom()
    }
  }, [messages, isStreamingResponse])

  // Use useLayoutEffect for scrolling to the latest user message
  // This runs synchronously after DOM mutations but before browser paints
  useLayoutEffect(() => {
    if (latestUserMessageIdRef.current && messagesContainerRef.current) {
      const messageId = latestUserMessageIdRef.current
      const container = messagesContainerRef.current
      
      console.log('useLayoutEffect scrolling to message:', messageId)
      
      // Find the message element by its data-message-id
      const messageElement = container.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement | null
      
      if (messageElement) {
        // Calculate position with 40px padding from the top
        const topPadding = 40
        const targetScrollTop = messageElement.offsetTop - topPadding
        
        // Apply scroll immediately (no smooth behavior)
        container.scrollTop = targetScrollTop
        
        console.log('Applied scroll in useLayoutEffect:', {
          messageId,
          elementOffsetTop: messageElement.offsetTop,
          targetScrollTop,
          actualScrollTop: container.scrollTop,
        })
        
        // Clear the ref to avoid unnecessary scrolling
        latestUserMessageIdRef.current = null
        
        // Restore smooth scrolling behavior after a brief delay
        // This ensures any subsequent scrolling is smooth
        setTimeout(() => {
          if (!isStreamingResponse) {
            setScrollBehavior('smooth')
          }
        }, 300)
      }
    }
  }, [messages, isStreamingResponse]) // Run this effect whenever messages or streaming state change

  // Fetch chat config function
  const fetchChatConfig = async () => {
    try {
      // Use relative URL instead of absolute URL with env.NEXT_PUBLIC_APP_URL
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
          } else if (errorData.error === 'auth_required_email') {
            setAuthRequired('email')
            return
          }
        }

        throw new Error(`Failed to load chat configuration: ${response.status}`)
      }

      const data = await response.json()

      // The API returns the data directly without a wrapper
      setChatConfig(data)

      // Add welcome message if configured
      if (data?.customizations?.welcomeMessage) {
        setMessages([
          {
            id: 'welcome',
            content: data.customizations.welcomeMessage,
            type: 'assistant',
            timestamp: new Date(),
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
    // Generate a new conversation ID whenever the page/chat is refreshed
    setConversationId(uuidv4())

    // Fetch GitHub stars
    getFormattedGitHubStars()
      .then((formattedStars) => {
        setStarCount(formattedStars)
      })
      .catch((err) => {
        console.error('Failed to fetch GitHub stars:', err)
      })
  }, [subdomain])

  // Handle keyboard input for message sending
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  // Handle keyboard input for auth forms
  const handleAuthKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAuthenticate()
    }
  }

  // Handle authentication
  const handleAuthenticate = async () => {
    if (authRequired === 'password') {
      // Password auth remains the same
      setAuthError(null)
      setIsAuthenticating(true)

      try {
        const payload = { password }

        const response = await fetch(`/api/chat/${subdomain}`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify(payload),
        })

        if (!response.ok) {
          const errorData = await response.json()
          setAuthError(errorData.error || 'Authentication failed')
          return
        }

        await response.json()

        // Authentication successful, fetch config again
        await fetchChatConfig()

        // Reset auth state
        setAuthRequired(null)
        setPassword('')
      } catch (error) {
        console.error('Authentication error:', error)
        setAuthError('An error occurred during authentication')
      } finally {
        setIsAuthenticating(false)
      }
    } else if (authRequired === 'email') {
      // For email auth, we now send an OTP first
      if (!showOtpVerification) {
        // Step 1: User has entered email, send OTP
        setAuthError(null)
        setIsSendingOtp(true)

        try {
          const response = await fetch(`/api/chat/${subdomain}/otp`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Requested-With': 'XMLHttpRequest',
            },
            body: JSON.stringify({ email }),
          })

          if (!response.ok) {
            const errorData = await response.json()
            setAuthError(errorData.error || 'Failed to send verification code')
            return
          }

          // OTP sent successfully, show OTP input
          setShowOtpVerification(true)
        } catch (error) {
          console.error('Error sending OTP:', error)
          setAuthError('An error occurred while sending the verification code')
        } finally {
          setIsSendingOtp(false)
        }
      } else {
        // Step 2: User has entered OTP, verify it
        setAuthError(null)
        setIsVerifyingOtp(true)

        try {
          const response = await fetch(`/api/chat/${subdomain}/otp`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'X-Requested-With': 'XMLHttpRequest',
            },
            body: JSON.stringify({ email, otp: otpValue }),
          })

          if (!response.ok) {
            const errorData = await response.json()
            setAuthError(errorData.error || 'Invalid verification code')
            return
          }

          await response.json()

          // OTP verified successfully, fetch config again
          await fetchChatConfig()

          // Reset auth state
          setAuthRequired(null)
          setEmail('')
          setOtpValue('')
          setShowOtpVerification(false)
        } catch (error) {
          console.error('Error verifying OTP:', error)
          setAuthError('An error occurred during verification')
        } finally {
          setIsVerifyingOtp(false)
        }
      }
    }
  }

  // Add this function to handle resending OTP
  const handleResendOtp = async () => {
    setAuthError(null)
    setIsSendingOtp(true)

    try {
      const response = await fetch(`/api/chat/${subdomain}/otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ email }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        setAuthError(errorData.error || 'Failed to resend verification code')
        return
      }

      // Show a message that OTP was sent
      setAuthError('Verification code sent. Please check your email.')
    } catch (error) {
      console.error('Error resending OTP:', error)
      setAuthError('An error occurred while resending the verification code')
    } finally {
      setIsSendingOtp(false)
    }
  }

  // Add a function to handle email input key down
  const handleEmailKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAuthenticate()
    }
  }

  // Add a function to handle OTP input key down
  const handleOtpKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAuthenticate()
    }
  }

  // Handle sending a message
  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      content: inputValue,
      type: 'user',
      timestamp: new Date(),
    }

    // Store the ID of the user message we're about to add
    latestUserMessageIdRef.current = userMessage.id
    
    // Add the user's message to the chat
    setMessages((prev) => [...prev, userMessage])
    setInputValue('')
    setIsLoading(true)
    
    // Reset scroll state when sending a new message
    setHasScrolled(false)
    setShowScrollButton(false)
    
    // Set scroll behavior to auto for immediate positioning
    setScrollBehavior('auto')
    
    // Ensure focus remains on input field
    if (inputRef.current) {
      inputRef.current.focus()
    }

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
        signal: abortControllerRef.current.signal
      })

      if (!response.ok) {
        throw new Error('Failed to get response')
      }

      // Detect streaming response via content-type (text/plain) or absence of JSON content-type
      const contentType = response.headers.get('Content-Type') || ''

      if (contentType.includes('text/plain')) {
        // Handle streaming response
        const messageId = crypto.randomUUID()
        
        // Set streaming state before adding the assistant message
        setIsStreamingResponse(true)
        
        // Keep scroll behavior as auto during streaming
        setScrollBehavior('auto')

        // Add placeholder message
        setMessages((prev) => [
          ...prev,
          {
            id: messageId,
            content: '',
            type: 'assistant',
            timestamp: new Date(),
          },
        ])

        // Stop showing loading indicator once streaming begins
        setIsLoading(false)

        // Ensure the response body exists and is a ReadableStream
        const reader = response.body?.getReader()
        if (reader) {
          const decoder = new TextDecoder()
          let done = false
          
          try {
            while (!done) {
              // Check if aborted before each read
              if (abortControllerRef.current === null) {
                console.log('Stream reading aborted')
                break
              }
              
              const { value, done: readerDone } = await reader.read()
              if (value) {
                const chunk = decoder.decode(value, { stream: true })
                if (chunk) {
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === messageId ? { ...msg, content: msg.content + chunk } : msg
                    )
                  )
                }
              }
              done = readerDone
            }
          } catch (error) {
            console.error('Error reading stream:', error)
          } finally {
            // Always reset streaming state and controller when done
            setIsStreamingResponse(false)
            abortControllerRef.current = null
            
            // Reset scroll behavior to smooth after streaming completes
            setScrollBehavior('smooth')
          }
        } else {
          setIsStreamingResponse(false)
          abortControllerRef.current = null
          setScrollBehavior('smooth')
        }
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
              } catch (e) {
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
                } catch (e) {
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
      // Reset streaming state if it wasn't already reset
      setIsStreamingResponse(false)
      // Ensure focus remains on input field even after the response
      if (inputRef.current) {
        inputRef.current.focus()
      }
    }
  }

  // Function to stop the streaming response
  const stopStreaming = () => {
    console.log('Stopping streaming response')
    
    if (abortControllerRef.current) {
      // Abort the fetch request
      abortControllerRef.current.abort()
      abortControllerRef.current = null
      
      // Add a message indicating the response was stopped
      setMessages(prev => {
        const lastMessage = prev[prev.length - 1]
        
        // Only modify if the last message is from the assistant (as expected)
        if (lastMessage && lastMessage.type === 'assistant') {
          // Append a note that the response was stopped
          const updatedContent = lastMessage.content + 
            (lastMessage.content ? '\n\n_Response stopped by user._' : '_Response stopped by user._')
          
          return [
            ...prev.slice(0, -1),
            { ...lastMessage, content: updatedContent }
          ]
        }
        
        return prev
      })
      
      // Reset streaming state
      setIsStreamingResponse(false)
      setScrollBehavior('smooth')
    }
  }

  // If error, show error message
  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="p-6 max-w-md mx-auto bg-white rounded-xl shadow-md">
          <div className="flex justify-between items-center mb-2">
            <a href="https://simstudio.ai" target="_blank" rel="noopener noreferrer">
              <svg
                width="32"
                height="32"
                viewBox="0 0 50 50"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="rounded-[6px]"
              >
                <rect width="50" height="50" fill="#701FFC" />
                <path
                  d="M34.1455 20.0728H16.0364C12.7026 20.0728 10 22.7753 10 26.1091V35.1637C10 38.4975 12.7026 41.2 16.0364 41.2H34.1455C37.4792 41.2 40.1818 38.4975 40.1818 35.1637V26.1091C40.1818 22.7753 37.4792 20.0728 34.1455 20.0728Z"
                  fill="#701FFC"
                  stroke="white"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M25.0919 14.0364C26.7588 14.0364 28.1101 12.6851 28.1101 11.0182C28.1101 9.35129 26.7588 8 25.0919 8C23.425 8 22.0737 9.35129 22.0737 11.0182C22.0737 12.6851 23.425 14.0364 25.0919 14.0364Z"
                  fill="#701FFC"
                  stroke="white"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M25.0915 14.856V19.0277V14.856ZM20.5645 32.1398V29.1216V32.1398ZM29.619 29.1216V32.1398V29.1216Z"
                  fill="#701FFC"
                />
                <path
                  d="M25.0915 14.856V19.0277M20.5645 32.1398V29.1216M29.619 29.1216V32.1398"
                  stroke="white"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="25" cy="11" r="2" fill="#701FFC" />
              </svg>
            </a>
            <HeaderLinks stars={starCount} />
          </div>
          <h2 className="text-xl font-bold text-red-500 mb-2">Error</h2>
          <p className="text-gray-700">{error}</p>
        </div>
      </div>
    )
  }

  // If authentication is required, show auth form
  if (authRequired) {
    // Get title and description from the URL params or use defaults
    const title = new URLSearchParams(window.location.search).get('title') || 'chat'
    const primaryColor = new URLSearchParams(window.location.search).get('color') || '#802FFF'

    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="p-6 max-w-md w-full mx-auto bg-white rounded-xl shadow-md">
          <div className="flex justify-between items-center w-full mb-4">
            <a href="https://simstudio.ai" target="_blank" rel="noopener noreferrer">
              <svg
                width="32"
                height="32"
                viewBox="0 0 50 50"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="rounded-[6px]"
              >
                <rect width="50" height="50" fill="#701FFC" />
                <path
                  d="M34.1455 20.0728H16.0364C12.7026 20.0728 10 22.7753 10 26.1091V35.1637C10 38.4975 12.7026 41.2 16.0364 41.2H34.1455C37.4792 41.2 40.1818 38.4975 40.1818 35.1637V26.1091C40.1818 22.7753 37.4792 20.0728 34.1455 20.0728Z"
                  fill="#701FFC"
                  stroke="white"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M25.0919 14.0364C26.7588 14.0364 28.1101 12.6851 28.1101 11.0182C28.1101 9.35129 26.7588 8 25.0919 8C23.425 8 22.0737 9.35129 22.0737 11.0182C22.0737 12.6851 23.425 14.0364 25.0919 14.0364Z"
                  fill="#701FFC"
                  stroke="white"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M25.0915 14.856V19.0277V14.856ZM20.5645 32.1398V29.1216V32.1398ZM29.619 29.1216V32.1398V29.1216Z"
                  fill="#701FFC"
                />
                <path
                  d="M25.0915 14.856V19.0277M20.5645 32.1398V29.1216M29.619 29.1216V32.1398"
                  stroke="white"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="25" cy="11" r="2" fill="#701FFC" />
              </svg>
            </a>
            <HeaderLinks stars={starCount} />
          </div>
          <div className="text-center mb-6">
            <h2 className="text-xl font-bold mb-2">{title}</h2>
            <p className="text-gray-600">
              {authRequired === 'password'
                ? 'This chat is password-protected. Please enter the password to continue.'
                : 'This chat requires email verification. Please enter your email to continue.'}
            </p>
          </div>

          {authError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-600 rounded-md">
              {authError}
            </div>
          )}

          <div className="space-y-4">
            {authRequired === 'password' ? (
              <div className="w-full max-w-sm mx-auto">
                <div className="bg-white dark:bg-black/10 rounded-lg shadow-sm p-6 space-y-4 border border-neutral-200 dark:border-neutral-800">
                  <div className="flex items-center justify-center">
                    <div className="p-2 rounded-full bg-primary/10 text-primary">
                      <Lock className="h-5 w-5" />
                    </div>
                  </div>

                  <h2 className="text-lg font-medium text-center">Password Required</h2>
                  <p className="text-neutral-500 dark:text-neutral-400 text-sm text-center">
                    Enter the password to access this chat
                  </p>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      handleAuthenticate()
                    }}
                  >
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <label htmlFor="password" className="text-sm font-medium sr-only">
                          Password
                        </label>
                        <Input
                          id="password"
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Enter password"
                          disabled={isAuthenticating}
                          className="w-full"
                        />
                      </div>

                      {authError && (
                        <div className="text-sm text-red-600 dark:text-red-500">{authError}</div>
                      )}

                      <Button
                        type="submit"
                        disabled={!password || isAuthenticating}
                        className="w-full"
                        style={{
                          backgroundColor: chatConfig?.customizations?.primaryColor || '#802FFF',
                        }}
                      >
                        {isAuthenticating ? (
                          <div className="flex items-center justify-center">
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Authenticating...
                          </div>
                        ) : (
                          'Continue'
                        )}
                      </Button>
                    </div>
                  </form>
                </div>
              </div>
            ) : (
              <div className="w-full max-w-sm mx-auto">
                <div className="bg-white dark:bg-black/10 rounded-lg shadow-md p-6 space-y-4 border border-neutral-200 dark:border-neutral-800">
                  <div className="flex items-center justify-center">
                    <div className="p-2 rounded-full bg-primary/10 text-primary">
                      <Mail className="h-5 w-5" />
                    </div>
                  </div>

                  <h2 className="text-lg font-medium text-center">Email Verification</h2>

                  {!showOtpVerification ? (
                    // Step 1: Email Input
                    <>
                      <p className="text-neutral-500 dark:text-neutral-400 text-sm text-center">
                        Enter your email address to access this chat
                      </p>

                      <div className="space-y-3">
                        <div className="space-y-1">
                          <label htmlFor="email" className="text-sm font-medium sr-only">
                            Email
                          </label>
                          <Input
                            id="email"
                            type="email"
                            placeholder="Email address"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            onKeyDown={handleEmailKeyDown}
                            disabled={isSendingOtp || isAuthenticating}
                            className="w-full"
                          />
                        </div>

                        {authError && (
                          <div className="text-sm text-red-600 dark:text-red-500">{authError}</div>
                        )}

                        <Button
                          onClick={handleAuthenticate}
                          disabled={!email || isSendingOtp || isAuthenticating}
                          className="w-full"
                          style={{
                            backgroundColor: chatConfig?.customizations?.primaryColor || '#802FFF',
                          }}
                        >
                          {isSendingOtp ? (
                            <div className="flex items-center justify-center">
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Sending Code...
                            </div>
                          ) : (
                            'Continue'
                          )}
                        </Button>
                      </div>
                    </>
                  ) : (
                    // Step 2: OTP Verification with OTPInputForm
                    <>
                      <p className="text-neutral-500 dark:text-neutral-400 text-sm text-center">
                        Enter the verification code sent to
                      </p>
                      <p className="text-center font-medium text-sm break-all mb-3">{email}</p>

                      <OTPInputForm
                        onSubmit={(value) => {
                          setOtpValue(value)
                          handleAuthenticate()
                        }}
                        isLoading={isVerifyingOtp}
                        error={authError}
                      />

                      <div className="flex items-center justify-center pt-3">
                        <button
                          type="button"
                          onClick={() => handleResendOtp()}
                          disabled={isSendingOtp}
                          className="text-sm text-primary hover:underline disabled:opacity-50"
                        >
                          {isSendingOtp ? 'Sending...' : 'Resend code'}
                        </button>
                        <span className="mx-2 text-neutral-300 dark:text-neutral-600">•</span>
                        <button
                          type="button"
                          onClick={() => {
                            setShowOtpVerification(false)
                            setOtpValue('')
                            setAuthError(null)
                          }}
                          className="text-sm text-primary hover:underline"
                        >
                          Change email
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Loading state while fetching config
  if (!chatConfig) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="animate-pulse text-center">
          <div className="h-8 w-48 bg-gray-200 rounded mx-auto mb-4"></div>
          <div className="h-4 w-64 bg-gray-200 rounded mx-auto"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[100] bg-background flex flex-col">
      <style jsx>{`
        @keyframes growShrink {
          0%,
          100% {
            transform: scale(0.9);
          }
          50% {
            transform: scale(1.1);
          }
        }
        .loading-dot {
          animation: growShrink 1.5s infinite ease-in-out;
        }
      `}</style>

      {/* Header with title and links */}
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <div className="flex items-center gap-2">
          {chatConfig?.customizations?.logoUrl && (
            <img
              src={chatConfig.customizations.logoUrl}
              alt={`${chatConfig?.title || 'Chat'} logo`}
              className="h-6 w-6 object-contain"
            />
          )}
          <h2 className="text-lg font-medium">
            {chatConfig?.customizations?.headerText || chatConfig?.title || 'Chat'}
          </h2>
        </div>
        <div className="flex items-center gap-3">
          <HeaderLinks stars={starCount} />
          {!chatConfig?.customizations?.logoUrl && (
            <a href="https://simstudio.ai" target="_blank" rel="noopener noreferrer">
              <svg
                width="32"
                height="32"
                viewBox="0 0 50 50"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="rounded-[6px]"
              >
                <rect width="50" height="50" fill="#701FFC" />
                <path
                  d="M34.1455 20.0728H16.0364C12.7026 20.0728 10 22.7753 10 26.1091V35.1637C10 38.4975 12.7026 41.2 16.0364 41.2H34.1455C37.4792 41.2 40.1818 38.4975 40.1818 35.1637V26.1091C40.1818 22.7753 37.4792 20.0728 34.1455 20.0728Z"
                  fill="#701FFC"
                  stroke="white"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M25.0919 14.0364C26.7588 14.0364 28.1101 12.6851 28.1101 11.0182C28.1101 9.35129 26.7588 8 25.0919 8C23.425 8 22.0737 9.35129 22.0737 11.0182C22.0737 12.6851 23.425 14.0364 25.0919 14.0364Z"
                  fill="#701FFC"
                  stroke="white"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M25.0915 14.856V19.0277V14.856ZM20.5645 32.1398V29.1216V32.1398ZM29.619 29.1216V32.1398V29.1216Z"
                  fill="#701FFC"
                />
                <path
                  d="M25.0915 14.856V19.0277M20.5645 32.1398V29.1216M29.619 29.1216V32.1398"
                  stroke="white"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="25" cy="11" r="2" fill="#701FFC" />
              </svg>
            </a>
          )}
        </div>
      </div>

      {/* Redesigned Message Container */}
      <div 
        className="relative flex-1 overflow-hidden"
        style={{ display: 'flex', flexDirection: 'column' }}
      >
        {/* Scrollable Messages Area */}
        <div 
          ref={messagesContainerRef}
          className="absolute inset-0 overflow-y-auto"
          style={{ 
            scrollBehavior: scrollBehavior,
            overscrollBehavior: 'contain',
            WebkitOverflowScrolling: 'touch'
          }}
        >
          
          {/* Actual Messages */}
          <div className="max-w-3xl mx-auto px-4 pt-10">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10">
                <div className="text-center space-y-2">
                  <h3 className="text-lg font-medium">How can I help you today?</h3>
                  <p className="text-muted-foreground text-sm">
                    {chatConfig.description || 'Ask me anything.'}
                  </p>
                </div>
              </div>
            ) : (
              messages.map((message) => <ClientChatMessage key={message.id} message={message} />)
            )}

            {/* Loading indicator (shows only when executing) */}
            {isLoading && (
              <div className="py-5 px-4">
                <div className="max-w-3xl mx-auto">
                  <div className="flex">
                    <div className="max-w-[80%]">
                      <div className="flex items-center h-6">
                        <div className="w-3 h-3 rounded-full bg-black dark:bg-black loading-dot"></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Bottom reference for scrolling */}
            <div ref={messagesEndRef} className="h-20 md:h-32" />
          </div>
        </div>
        
        {/* Scroll to bottom button - appears when user scrolls up or during streaming */}
        {(showScrollButton || isStreamingResponse) && (
          <div className="absolute bottom-5 left-1/2 transform -translate-x-1/2 z-10">
            <Button
              onClick={scrollToBottom}
              size="sm"
              variant="outline"
              className="rounded-full py-1 px-3 border border-gray-200 bg-white shadow-md hover:bg-gray-50 transition-all flex items-center gap-1"
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* Input area (fixed at bottom) */}
      <div className="bg-background p-6 border-t relative">        
        <div className="max-w-3xl mx-auto">
          <div className="relative rounded-2xl border bg-background shadow-sm">
            <Input
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isStreamingResponse ? "Generating response..." : "Message..."}
              className="flex-1 border-0 focus-visible:ring-0 focus-visible:ring-offset-0 py-7 pr-16 bg-transparent pl-6 text-base min-h-[50px] rounded-2xl"
              disabled={isStreamingResponse}
            />
            {isStreamingResponse ? (
              <Button
                onClick={stopStreaming}
                size="icon"
                className="absolute right-3 top-1/2 -translate-y-1/2 h-10 w-10 p-0 rounded-xl bg-red-500 hover:bg-red-600 text-white"
              >
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                onClick={handleSendMessage}
                size="icon"
                disabled={!inputValue.trim() || isLoading}
                className="absolute right-3 top-1/2 -translate-y-1/2 h-10 w-10 p-0 rounded-xl bg-black text-white hover:bg-gray-800"
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}