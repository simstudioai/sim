'use client'

import { FormEvent, useState } from 'react'
import { z } from 'zod'
import { AlertTriangle, Check, Circle, Copy, Eye, EyeOff, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { createLogger } from '@/lib/logs/console-logger'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

const logger = createLogger('ChatbotDeploymentModal')

interface ChatDeploymentModalProps {
  isOpen: boolean
  onClose: () => void
  workflowId: string
}

type AuthType = 'public' | 'password' | 'email'

// Define Zod schema for API request validation
const chatbotSchema = z.object({
  workflowId: z.string().min(1, "Workflow ID is required"),
  subdomain: z.string().min(1, "Subdomain is required").regex(/^[a-z0-9-]+$/, "Subdomain can only contain lowercase letters, numbers, and hyphens"),
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  customizations: z.object({
    primaryColor: z.string(),
    welcomeMessage: z.string(),
  }),
  authType: z.enum(["public", "password", "email"]),
  password: z.string().optional(),
  allowedEmails: z.array(z.string()).optional(),
})

export function ChatbotDeploymentModal({ isOpen, onClose, workflowId }: ChatDeploymentModalProps) {
  // Form state
  const [subdomain, setSubdomain] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [isDeploying, setIsDeploying] = useState(false)
  const [subdomainError, setSubdomainError] = useState('')
  const [deployedChatbotUrl, setDeployedChatbotUrl] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  
  // Authentication options
  const [authType, setAuthType] = useState<AuthType>('public')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [emails, setEmails] = useState<string[]>([])
  const [newEmail, setNewEmail] = useState('')
  const [emailError, setEmailError] = useState('')

  // Reset form state when modal opens/closes
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      // Reset form when closing
      setSubdomain('')
      setTitle('')
      setDescription('')
      setSubdomainError('')
      setDeployedChatbotUrl(null)
      setErrorMessage(null)
      setIsDeploying(false)
      setAuthType('public')
      setPassword('')
      setShowPassword(false)
      setEmails([])
      setNewEmail('')
      setEmailError('')
      onClose()
    }
  }

  // Validate subdomain format on input change
  const handleSubdomainChange = (value: string) => {
    const lowercaseValue = value.toLowerCase()
    setSubdomain(lowercaseValue)
    
    // Validate subdomain format
    if (lowercaseValue && !/^[a-z0-9-]+$/.test(lowercaseValue)) {
      setSubdomainError('Subdomain can only contain lowercase letters, numbers, and hyphens')
    } else {
      setSubdomainError('')
    }
  }
  
  // Validate and add email
  const handleAddEmail = () => {
    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail) && !newEmail.startsWith('@')) {
      setEmailError('Please enter a valid email or domain (e.g., user@example.com or @example.com)')
      return
    }
    
    // Add email if it's not already in the list
    if (!emails.includes(newEmail)) {
      setEmails([...emails, newEmail])
      setNewEmail('')
      setEmailError('')
    } else {
      setEmailError('This email or domain is already in the list')
    }
  }
  
  // Remove email from the list
  const handleRemoveEmail = (email: string) => {
    setEmails(emails.filter(e => e !== email))
  }

  // Password generation and copy functionality
  const generatePassword = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_-+='
    let result = ''
    const length = 24
    
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    
    setPassword(result)
    setShowPassword(false)
  }
  
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  // Deploy chatbot
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    
    if (!workflowId || !subdomain.trim() || !title.trim()) {
      return
    }
    
    if (subdomainError) {
      return
    }
    
    // Validate authentication options
    if (authType === 'password' && !password.trim()) {
      setErrorMessage('Password is required when using password protection')
      return
    }
    
    if (authType === 'email' && emails.length === 0) {
      setErrorMessage('At least one email or domain is required when using email access control')
      return
    }
    
    setErrorMessage(null)
    
    try {
      setIsDeploying(true)
      
      // Create request payload and validate with Zod
      const payload = {
        workflowId,
        subdomain: subdomain.trim(),
        title: title.trim(),
        description: description.trim(),
        customizations: {
          primaryColor: '#802FFF',
          welcomeMessage: 'Hi there! How can I help you today?',
        },
        authType,
        password: authType === 'password' ? password : undefined,
        allowedEmails: authType === 'email' ? emails : [],
      }
      
      try {
        chatbotSchema.parse(payload)
      } catch (validationError: any) {
        if (validationError instanceof z.ZodError) {
          const errorMessage = validationError.errors[0]?.message || 'Invalid form data'
          setErrorMessage(errorMessage)
          return
        }
      }
      
      const response = await fetch('/api/chatbot', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
      
      const result = await response.json()
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to deploy chatbot')
      }
      
      const { chatbotUrl } = result
      
      if (chatbotUrl) {
        logger.info('Chatbot deployed successfully:', chatbotUrl)
        setDeployedChatbotUrl(chatbotUrl)
      } else {
        throw new Error('Response missing chatbotUrl')
      }
    } catch (error: any) {
      logger.error('Failed to deploy chatbot:', error)
      setErrorMessage(error.message || 'An unexpected error occurred')
    } finally {
      setIsDeploying(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="text-xl">Deploy Workflow as Chatbot</DialogTitle>
          <DialogDescription className="text-muted-foreground mt-1.5">
            Create a chatbot interface for your workflow that others can access via a custom URL.
          </DialogDescription>
        </DialogHeader>

        {deployedChatbotUrl ? (
          // Success view
          <div className="space-y-6 py-4">
            <Card className="border-green-200 bg-green-50">
              <CardContent className="p-6 text-green-800">
                <h3 className="text-base font-medium mb-2">Chatbot Deployment Successful</h3>
                <p className="mb-3">Your chatbot is now available at:</p>
                <div className="bg-white/50 p-3 rounded-md border border-green-200">
                  <a 
                    href={deployedChatbotUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-primary underline break-all block"
                  >
                    {deployedChatbotUrl}
                  </a>
                </div>
              </CardContent>
            </Card>
            
            <div className="space-y-3 p-4 bg-muted/30 rounded-lg">
              <h4 className="font-medium">Next Steps</h4>
              <ul className="space-y-2 list-disc list-inside text-muted-foreground">
                <li>Share this URL with your users</li>
                <li>Visit the URL to test your chatbot</li>
                <li>Manage your chatbots from the Deployments page</li>
              </ul>
            </div>
          </div>
        ) : (
          // Form view
          <form onSubmit={handleSubmit} className="space-y-6 py-4">
            <div className="grid gap-6">
              {errorMessage && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>
              )}
              
              <div className="space-y-4">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="subdomain" className="text-sm font-medium">
                      Subdomain
                    </Label>
                    <div className="flex items-center">
                      <Input
                        id="subdomain"
                        placeholder="company-name"
                        value={subdomain}
                        onChange={(e) => handleSubdomainChange(e.target.value)}
                        required
                        className="rounded-r-none border-r-0"
                        disabled={isDeploying}
                      />
                      <div className="h-10 px-3 flex items-center border rounded-r-md bg-muted text-muted-foreground text-sm font-medium whitespace-nowrap">
                        .simstudio.ai
                      </div>
                    </div>
                    {subdomainError && (
                      <p className="text-sm text-destructive mt-1">{subdomainError}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="title" className="text-sm font-medium">
                      Chatbot Title
                    </Label>
                    <Input
                      id="title"
                      placeholder="Customer Support Assistant"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      required
                      disabled={isDeploying}
                    />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="description" className="text-sm font-medium">
                    Description (Optional)
                  </Label>
                  <Textarea
                    id="description"
                    placeholder="A brief description of what this chatbot does"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    disabled={isDeploying}
                  />
                </div>
              </div>
              
              {/* Authentication Options */}
              <div className="space-y-4">
                <div>
                  <Label className="text-sm font-medium">Access Control</Label>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <Card 
                    className={cn(
                      "cursor-pointer overflow-hidden border transition-colors hover:border-primary/50",
                      authType === "public" ? "border-primary bg-primary/5" : "border-border"
                    )}
                    onClick={() => !isDeploying && setAuthType('public')}
                  >
                    <CardContent className="p-4 flex flex-col items-center text-center space-y-2">
                      <div className="h-5 w-5 flex items-center justify-center mb-1">
                        {authType === 'public' ? (
                          <Check className="h-4 w-4 text-primary" />
                        ) : (
                          <Circle className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <div>
                        <h3 className="font-medium text-sm">Public Access</h3>
                        <p className="text-xs text-muted-foreground mt-1">Anyone can access your chatbot</p>
                      </div>
                    </CardContent>
                  </Card>
                  
                  <Card 
                    className={cn(
                      "cursor-pointer overflow-hidden border transition-colors hover:border-primary/50",
                      authType === "password" ? "border-primary bg-primary/5" : "border-border"
                    )}
                    onClick={() => !isDeploying && setAuthType('password')}
                  >
                    <CardContent className="p-4 flex flex-col items-center text-center space-y-2">
                      <div className="h-5 w-5 flex items-center justify-center mb-1">
                        {authType === 'password' ? (
                          <Check className="h-4 w-4 text-primary" />
                        ) : (
                          <Circle className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <div>
                        <h3 className="font-medium text-sm">Password Protected</h3>
                        <p className="text-xs text-muted-foreground mt-1">Secure with a single password</p>
                      </div>
                    </CardContent>
                  </Card>
                  
                  <Card 
                    className={cn(
                      "cursor-pointer overflow-hidden border transition-colors hover:border-primary/50",
                      authType === "email" ? "border-primary bg-primary/5" : "border-border"
                    )}
                    onClick={() => !isDeploying && setAuthType('email')}
                  >
                    <CardContent className="p-4 flex flex-col items-center text-center space-y-2">
                      <div className="h-5 w-5 flex items-center justify-center mb-1">
                        {authType === 'email' ? (
                          <Check className="h-4 w-4 text-primary" />
                        ) : (
                          <Circle className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <div>
                        <h3 className="font-medium text-sm">Email Access</h3>
                        <p className="text-xs text-muted-foreground mt-1">Restrict to specific emails</p>
                      </div>
                    </CardContent>
                  </Card>
                </div>
                
                {authType === 'password' && (
                  <Card className="border-border/40">
                    <CardContent className="p-4 space-y-4">
                      <div className="flex justify-between items-center">
                        <h3 className="text-sm font-medium">Password Settings</h3>
                        <Button 
                          type="button" 
                          variant="outline" 
                          size="sm"
                          onClick={generatePassword}
                          disabled={isDeploying}
                          className="h-8"
                        >
                          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                          Generate Password
                        </Button>
                      </div>
                      <div className="relative">
                        <Input
                          type={showPassword ? 'text' : 'password'}
                          placeholder="Enter password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          disabled={isDeploying}
                          className="pr-20"
                        />
                        <div className="absolute right-0 top-0 h-full flex">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => copyToClipboard(password)}
                            disabled={!password || isDeploying}
                            className="h-full opacity-70 hover:opacity-100"
                            title="Copy password"
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setShowPassword(!showPassword)}
                            className="h-full opacity-70 hover:opacity-100"
                            title={showPassword ? "Hide password" : "Show password"}
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
                
                {authType === 'email' && (
                  <Card className="border-border/40">
                    <CardContent className="p-4 space-y-4">
                      <div>
                        <h3 className="text-sm font-medium mb-2">Email Access Settings</h3>
                        <p className="text-xs text-muted-foreground">
                          Add specific emails or entire domains (@example.com)
                        </p>
                      </div>
                      
                      <div className="flex gap-2">
                        <Input
                          placeholder="user@example.com or @domain.com"
                          value={newEmail}
                          onChange={(e) => setNewEmail(e.target.value)}
                          disabled={isDeploying}
                          className="flex-1"
                        />
                        <Button
                          type="button"
                          size="sm"
                          onClick={handleAddEmail}
                          disabled={!newEmail.trim() || isDeploying}
                          className="shrink-0"
                        >
                          <Plus className="h-4 w-4 mr-1" />
                          Add
                        </Button>
                      </div>
                      
                      {emailError && (
                        <p className="text-sm text-destructive">{emailError}</p>
                      )}
                      
                      {emails.length > 0 && (
                        <div className="bg-muted/50 rounded-lg border border-muted p-3 max-h-36 overflow-y-auto">
                          <ul className="space-y-2 divide-y divide-border/40">
                            {emails.map((email) => (
                              <li key={email} className="flex justify-between items-center py-1.5 text-sm">
                                <span className="font-medium">{email}</span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleRemoveEmail(email)}
                                  disabled={isDeploying}
                                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>
              
              <Alert className="bg-muted/30 border-muted">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-sm text-muted-foreground">
                  Your workflow must be deployed before creating a chatbot.
                </AlertDescription>
              </Alert>
            </div>
            
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={isDeploying}
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={
                  isDeploying || 
                  !subdomain || 
                  !title || 
                  !!subdomainError || 
                  (authType === 'password' && !password) ||
                  (authType === 'email' && emails.length === 0)
                }
              >
                {isDeploying ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Deploying...
                  </>
                ) : (
                  'Deploy Chatbot'
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}