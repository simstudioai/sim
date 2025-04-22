'use client'

import { KeyboardEvent, useEffect, useRef, useState } from 'react'
import { ArrowUp, Loader2, Lock, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { OTPInputForm } from '@/components/ui/input-otp-form'

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

export default function ChatClient({ subdomain }: { subdomain: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [chatConfig, setChatConfig] = useState<ChatConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

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
              messageContent = "Received structured data response"
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

  // Get primary color from customizations or use default
  const primaryColor = chatConfig.customizations?.primaryColor || '#802FFF'

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <header
        className="p-4 shadow-sm flex items-center"
        style={{ backgroundColor: primaryColor, color: 'white' }}
      >
        {chatConfig.customizations?.logoUrl && (
          <img
            src={chatConfig.customizations.logoUrl}
            alt={`${chatConfig.title} logo`}
            className="h-8 w-8 object-contain mr-3"
          />
        )}
        <h1 className="text-lg font-medium">
          {chatConfig.customizations?.headerText || chatConfig.title}
        </h1>
      </header>

      {/* Chat area */}
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full p-4">
          <div className="space-y-4 max-w-3xl mx-auto">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  'px-4 py-3 rounded-lg max-w-[85%]',
                  message.type === 'user'
                    ? 'ml-auto bg-blue-500 text-white'
                    : 'mr-auto bg-white border text-gray-800'
                )}
              >
                <div className="whitespace-pre-wrap break-words">{message.content}</div>
                <div
                  className={cn(
                    'text-xs mt-1',
                    message.type === 'user' ? 'text-blue-100' : 'text-gray-400'
                  )}
                >
                  {message.timestamp.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex items-center px-4 py-3 rounded-lg bg-white border mr-auto">
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                  <div
                    className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                    style={{ animationDelay: '0.2s' }}
                  ></div>
                  <div
                    className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                    style={{ animationDelay: '0.4s' }}
                  ></div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>
      </div>

      {/* Input area */}
      <div className="p-4 border-t bg-white">
        <div className="flex max-w-3xl mx-auto">
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className="flex-1 focus-visible:ring-0 focus-visible:ring-offset-0"
            disabled={isLoading}
          />
          <Button
            onClick={handleSendMessage}
            disabled={!inputValue.trim() || isLoading}
            className="ml-2"
            style={{ backgroundColor: primaryColor }}
          >
            <ArrowUp className="h-4 w-4" />
            <span className="sr-only">Send</span>
          </Button>
        </div>
      </div>
    </div>
  )
}
