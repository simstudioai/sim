'use client'

import { KeyboardEvent, useEffect, useRef, useState } from 'react'
import { ArrowUp, Loader2, Lock, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

// Define message type
interface ChatMessage {
  id: string
  content: string
  type: 'user' | 'assistant'
  timestamp: Date
}

// Define chatbot config type
interface ChatbotConfig {
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

export default function ChatbotClient({ subdomain }: { subdomain: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [chatbotConfig, setChatbotConfig] = useState<ChatbotConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  
  // Authentication state
  const [authRequired, setAuthRequired] = useState<'password' | 'email' | null>(null)
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  
  // Fetch chatbot config on mount
  useEffect(() => {
    async function fetchChatbotConfig() {
      try {
        // Use relative URL instead of absolute URL with process.env.NEXT_PUBLIC_APP_URL
        const response = await fetch(`/api/chatbot/${subdomain}`, {
          credentials: 'same-origin',
          headers: {
            'X-Requested-With': 'XMLHttpRequest'
          }
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
          
          throw new Error(`Failed to load chatbot configuration: ${response.status}`)
        }
        
        const data = await response.json()
        
        // The API returns the data directly without a wrapper
        setChatbotConfig(data)
        
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
        console.error('Error fetching chatbot config:', error)
        setError('This chatbot is currently unavailable. Please try again later.')
      }
    }
    
    fetchChatbotConfig()
  }, [subdomain])
  
  // Handle authentication
  const handleAuthenticate = async () => {
    setAuthError(null)
    setIsAuthenticating(true)
    
    try {
      const payload = authRequired === 'password' 
        ? { password } 
        : { email }
      
      const response = await fetch(`/api/chatbot/${subdomain}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
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
      const configResponse = await fetch(`/api/chatbot/${subdomain}`, {
        credentials: 'same-origin',
        headers: {
          'X-Requested-With': 'XMLHttpRequest'
        }
      })
      
      if (!configResponse.ok) {
        throw new Error('Failed to load chatbot configuration after authentication')
      }
      
      const data = await configResponse.json()
      setChatbotConfig(data)
      
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
      
      // Reset auth state
      setAuthRequired(null)
      setPassword('')
      setEmail('')
      
    } catch (error) {
      console.error('Authentication error:', error)
      setAuthError('An error occurred during authentication')
    } finally {
      setIsAuthenticating(false)
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
      const response = await fetch(`/api/chatbot/${subdomain}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({ message: userMessage.content }),
      })
      
      if (!response.ok) {
        throw new Error('Failed to get response')
      }
      
      const responseData = await response.json()
      console.log('Message response:', responseData)
      
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        content: responseData.output || 'Sorry, I couldn\'t process your request.',
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
  
  // Handle keyboard input
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }
  
  // Handle auth form keyboard input
  const handleAuthKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAuthenticate()
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
    const title = new URLSearchParams(window.location.search).get('title') || 'Chatbot'
    const primaryColor = new URLSearchParams(window.location.search).get('color') || '#802FFF'
    
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="p-6 max-w-md w-full mx-auto bg-white rounded-xl shadow-md">
          <div className="text-center mb-6">
            <h2 className="text-xl font-bold mb-2">{title}</h2>
            <p className="text-gray-600">
              {authRequired === 'password' 
                ? 'This chatbot is password-protected. Please enter the password to continue.' 
                : 'This chatbot requires email verification. Please enter your email to continue.'}
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
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={handleAuthKeyDown}
                  placeholder="Enter your email"
                  className="pl-10"
                  disabled={isAuthenticating}
                />
              </div>
            )}
            
            <Button 
              onClick={handleAuthenticate} 
              className="w-full"
              style={{ backgroundColor: primaryColor }}
              disabled={isAuthenticating || (authRequired === 'password' ? !password : !email)}
            >
              {isAuthenticating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Authenticating...
                </>
              ) : (
                'Continue'
              )}
            </Button>
          </div>
        </div>
      </div>
    )
  }
  
  // Loading state while fetching config
  if (!chatbotConfig) {
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
  const primaryColor = chatbotConfig.customizations?.primaryColor || '#802FFF'
  
  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <header 
        className="p-4 shadow-sm flex items-center" 
        style={{ backgroundColor: primaryColor, color: 'white' }}
      >
        {chatbotConfig.customizations?.logoUrl && (
          <img 
            src={chatbotConfig.customizations.logoUrl} 
            alt={`${chatbotConfig.title} logo`} 
            className="h-8 w-8 object-contain mr-3"
          />
        )}
        <h1 className="text-lg font-medium">
          {chatbotConfig.customizations?.headerText || chatbotConfig.title}
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
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
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