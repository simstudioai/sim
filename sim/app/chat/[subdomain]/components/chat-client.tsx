'use client'

import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Loader2, Lock, Mail } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { OTPInputForm } from '@/components/ui/input-otp-form'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

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

// Markdown renderer component with proper styling
function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div
      className="prose dark:prose-invert max-w-none 
      text-base leading-normal 
      text-[#0D0D0D] dark:text-gray-100
      [&>*]:text-base
      [&>*]:leading-normal
      [&>p]:my-[0.35em]
      [&>p+p]:mt-[0.7em]
      [&>ul]:my-[0.35em]
      [&>ol]:my-[0.35em]
      [&>h1]:text-xl [&>h1]:font-semibold [&>h1]:mb-[0.5em] [&>h1]:mt-[0.7em]
      [&>h2]:text-lg [&>h2]:font-semibold [&>h2]:mb-[0.4em] [&>h2]:mt-[0.7em]
      [&>h3]:text-base [&>h3]:font-semibold [&>h3]:mb-[0.3em] [&>h3]:mt-[0.6em]
      [&>ul>li]:pl-0 [&>ol>li]:pl-0 
      [&>ol>li]:relative [&>ul>li]:relative
      [&>ul>li]:pl-5 [&>ol>li]:pl-5
      [&>ul>li]:mb-[0.2em] [&>ol>li]:mb-[0.2em]
      [&>ul]:pl-1 [&>ol]:pl-1
      [&>pre]:bg-gray-100 [&>pre]:dark:bg-gray-800 [&>pre]:p-3 [&>pre]:rounded-md [&>pre]:my-[0.7em]
      [&>code]:text-[0.9em] [&>code]:bg-gray-100 [&>code]:dark:bg-gray-800 [&>code]:px-1 [&>code]:py-0.5 [&>code]:rounded-md
      [&>p>code]:text-[0.9em] [&>p>code]:bg-gray-100 [&>p>code]:dark:bg-gray-800 [&>p>code]:px-1 [&>p>code]:py-0.5 [&>p>code]:rounded-md
      [&>blockquote]:border-l-4 [&>blockquote]:border-gray-200 [&>blockquote]:pl-4 [&>blockquote]:py-0.5 [&>blockquote]:my-[0.7em] [&>blockquote]:italic [&>blockquote]:text-gray-700 [&>blockquote]:dark:text-gray-300
      [&>table]:border-collapse [&>table]:w-full [&>table]:my-[0.7em]
      [&>table>thead>tr>th]:border [&>table>thead>tr>th]:border-gray-300 [&>table>thead>tr>th]:dark:border-gray-700 [&>table>thead>tr>th]:p-2 [&>table>thead>tr>th]:bg-gray-100 [&>table>thead>tr>th]:dark:bg-gray-800
      [&>table>tbody>tr>td]:border [&>table>tbody>tr>td]:border-gray-300 [&>table>tbody>tr>td]:dark:border-gray-700 [&>table>tbody>tr>td]:p-2"
    >
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  )
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
      <div className="py-5 px-4">
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
    <div className="py-5 px-4">
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

  // Fetch chat config function
  const fetchChatConfig = async () => {
    try {
      // Use relative URL instead of absolute URL with process.env.NEXT_PUBLIC_APP_URL
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

  // Fetch chat config on mount
  useEffect(() => {
    fetchChatConfig()
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

  // Scroll to bottom of messages
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  // Handle sending a message
  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      content: inputValue,
      type: 'user',
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInputValue('')
    setIsLoading(true)

    // Ensure focus remains on input field
    if (inputRef.current) {
      inputRef.current.focus()
    }

    try {
      // Use relative URL with credentials
      const response = await fetch(`/api/chat/${subdomain}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ message: userMessage.content }),
      })

      if (!response.ok) {
        throw new Error('Failed to get response')
      }

      const responseData = await response.json()
      console.log('Message response:', responseData)

      // Handle different response formats from API
      if (responseData.multipleOutputs && responseData.contents && Array.isArray(responseData.contents)) {
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
            content: formattedContent || "No content found",
            type: 'assistant' as const,
            timestamp: new Date(),
          }
        })
        
        // Add all messages at once
        setMessages((prev) => [...prev, ...assistantMessages])
      } else {
        // Handle single output as before
        // Extract content from the response - could be in content or output
        let messageContent = responseData.output

        // Handle different response formats from API
        if (!messageContent && responseData.content) {
          // Content could be an object or a string
          if (typeof responseData.content === 'object') {
            // If it's an object with a text property, use that
            if (responseData.content.text) {
              messageContent = responseData.content.text
            } else {
              // Try to convert to string for display
              try {
                messageContent = JSON.stringify(responseData.content)
              } catch (e) {
                messageContent = 'Received structured data response'
              }
            }
          } else {
            // Direct string content
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
      // Ensure focus remains on input field even after the response
      if (inputRef.current) {
        inputRef.current.focus()
      }
    }
  }

  // If error, show error message
  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="p-6 max-w-md mx-auto bg-white rounded-xl shadow-md">
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
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={handleAuthKeyDown}
                  placeholder="Enter password"
                  className="pl-10"
                  disabled={isAuthenticating}
                />
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
            transform: scale(0.9)
          }
          50% {
            transform: scale(1.1)
          }
        }
        .loading-dot {
          animation: growShrink 1.5s infinite ease-in-out
        }
      `}</style>

      {/* Header with title */}
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-lg font-medium">
          {chatConfig.customizations?.headerText || chatConfig.title || 'Chat'}
        </h2>
        {chatConfig.customizations?.logoUrl && (
          <img
            src={chatConfig.customizations.logoUrl}
            alt={`${chatConfig.title} logo`}
            className="h-6 w-6 object-contain"
          />
        )}
      </div>

      {/* Messages container */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-10 px-4">
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

          <div ref={messagesEndRef} className="h-1" />
        </div>
      </div>

      {/* Input area (fixed at bottom) */}
      <div className="bg-background p-6">
        <div className="max-w-3xl mx-auto">
          <div className="relative rounded-2xl border bg-background shadow-sm">
            <Input
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message..."
              className="flex-1 border-0 focus-visible:ring-0 focus-visible:ring-offset-0 py-7 pr-16 bg-transparent pl-6 text-base min-h-[50px] rounded-2xl"
            />
            <Button
              onClick={handleSendMessage}
              size="icon"
              disabled={!inputValue.trim() || isLoading}
              className="absolute right-3 top-1/2 -translate-y-1/2 h-10 w-10 p-0 rounded-xl bg-black text-white hover:bg-gray-800"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
