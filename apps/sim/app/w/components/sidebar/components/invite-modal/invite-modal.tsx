'use client'

import { type KeyboardEvent, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface InviteModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onInviteMember?: (email: string) => void
}

interface EmailTagProps {
  email: string
  onRemove: () => void
  disabled?: boolean
  isInvalid?: boolean
}

const EmailTag = ({ email, onRemove, disabled, isInvalid }: EmailTagProps) => (
  <div
    className={`flex items-center ${isInvalid ? 'border-red-200 bg-red-50 text-red-700' : 'border-gray-200 bg-gray-100 text-slate-700'} my-0 ml-0 w-auto gap-1 rounded-md border px-2 py-0.5 text-sm`}
  >
    <span className='max-w-[180px] truncate'>{email}</span>
    {!disabled && (
      <button
        type='button'
        onClick={onRemove}
        className={`${isInvalid ? 'text-red-400 hover:text-red-600' : 'text-gray-400 hover:text-gray-600'} flex-shrink-0 focus:outline-none`}
        aria-label={`Remove ${email}`}
      >
        <X className='h-3 w-3' />
      </button>
    )}
  </div>
)

const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

export function InviteModal({ open, onOpenChange }: InviteModalProps) {
  const [inputValue, setInputValue] = useState('')
  const [emails, setEmails] = useState<string[]>([])
  const [invalidEmails, setInvalidEmails] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showSent, setShowSent] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const { activeWorkspaceId } = useWorkflowRegistry()

  const addEmail = (email: string) => {
    // Normalize by trimming and converting to lowercase
    const normalizedEmail = email.trim().toLowerCase()

    if (!normalizedEmail) return false

    // Check for duplicates
    if (emails.includes(normalizedEmail) || invalidEmails.includes(normalizedEmail)) {
      return false
    }

    // Validate email format
    if (!isValidEmail(normalizedEmail)) {
      setInvalidEmails([...invalidEmails, normalizedEmail])
      setInputValue('')
      return false
    }

    // Add to emails array
    setEmails([...emails, normalizedEmail])
    setInputValue('')
    return true
  }

  const removeEmail = (index: number) => {
    const newEmails = [...emails]
    newEmails.splice(index, 1)
    setEmails(newEmails)
  }

  const removeInvalidEmail = (index: number) => {
    const newInvalidEmails = [...invalidEmails]
    newInvalidEmails.splice(index, 1)
    setInvalidEmails(newInvalidEmails)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Add email on Enter, comma, or space
    if (['Enter', ',', ' '].includes(e.key) && inputValue.trim()) {
      e.preventDefault()
      addEmail(inputValue)
    }

    // Remove the last email on Backspace if input is empty
    if (e.key === 'Backspace' && !inputValue) {
      if (invalidEmails.length > 0) {
        removeInvalidEmail(invalidEmails.length - 1)
      } else if (emails.length > 0) {
        removeEmail(emails.length - 1)
      }
    }
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    const pastedText = e.clipboardData.getData('text')
    const pastedEmails = pastedText
      .split(/[\s,;]+/) // Split by space, comma, or semicolon
      .filter(Boolean) // Remove empty strings

    const validEmails = pastedEmails.filter((email) => {
      return addEmail(email)
    })

    // If we didn't add any emails, keep the current input value
    if (validEmails.length === 0 && pastedEmails.length === 1) {
      setInputValue(inputValue + pastedEmails[0])
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Add current input as an email if it's valid
    if (inputValue.trim()) {
      addEmail(inputValue)
    }

    // Clear any previous error or success messages
    setErrorMessage(null)
    setSuccessMessage(null)

    // Don't proceed if no emails or no workspace
    if (emails.length === 0 || !activeWorkspaceId) {
      return
    }

    setIsSubmitting(true)

    try {
      // Track failed invitations
      const failedInvites: string[] = []

      // Send invitations in parallel
      const results = await Promise.all(
        emails.map(async (email) => {
          try {
            const response = await fetch('/api/workspaces/invitations', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                workspaceId: activeWorkspaceId,
                email: email,
                role: 'member', // Default role for invited members
              }),
            })

            const data = await response.json()

            if (!response.ok) {
              // Don't add to invalid emails if it's already in the valid emails array
              if (!invalidEmails.includes(email)) {
                failedInvites.push(email)
              }

              // Display the error message from the API if it exists
              if (data.error) {
                setErrorMessage(data.error)
              }

              return false
            }

            return true
          } catch (_err) {
            // Don't add to invalid emails if it's already in the valid emails array
            if (!invalidEmails.includes(email)) {
              failedInvites.push(email)
            }
            return false
          }
        })
      )

      const successCount = results.filter(Boolean).length

      if (successCount > 0) {
        // Clear everything on success, but keep track of failed emails
        setInputValue('')

        // Only keep emails that failed in the emails array
        if (failedInvites.length > 0) {
          setEmails(failedInvites)
        } else {
          setEmails([])
          // Set success message when all invitations are successful
          setSuccessMessage(
            successCount === 1
              ? 'Invitation sent successfully!'
              : `${successCount} invitations sent successfully!`
          )
        }

        setInvalidEmails([])
        setShowSent(true)

        // Revert button text after 2 seconds
        setTimeout(() => {
          setShowSent(false)
        }, 4000)
      }
    } catch (err: any) {
      console.error('Error inviting members:', err)
      setErrorMessage('An unexpected error occurred. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const resetState = () => {
    setInputValue('')
    setEmails([])
    setInvalidEmails([])
    setShowSent(false)
    setErrorMessage(null)
    setSuccessMessage(null)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(newOpen) => {
        if (!newOpen) {
          resetState()
        }
        onOpenChange(newOpen)
      }}
    >
      <DialogContent
        className='flex flex-col gap-0 overflow-hidden p-0 sm:max-w-[500px]'
        hideCloseButton
      >
        <DialogHeader className='flex-shrink-0 border-b px-6 py-4'>
          <div className='flex items-center justify-between'>
            <DialogTitle className='font-medium text-lg'>Invite Members to Workspace</DialogTitle>
            <Button
              variant='ghost'
              size='icon'
              className='h-8 w-8 p-0'
              onClick={() => onOpenChange(false)}
            >
              <X className='h-4 w-4' />
              <span className='sr-only'>Close</span>
            </Button>
          </div>
        </DialogHeader>

        <div className='px-6 pt-4 pb-6'>
          <form onSubmit={handleSubmit}>
            <div className='space-y-4'>
              <div className='space-y-2'>
                <label htmlFor='emails' className='font-medium text-sm'>
                  Email Addresses
                </label>
                <div
                  className={cn(
                    'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-3 py-1 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2'
                  )}
                >
                  {invalidEmails.map((email, index) => (
                    <EmailTag
                      key={`invalid-${index}`}
                      email={email}
                      onRemove={() => removeInvalidEmail(index)}
                      disabled={isSubmitting}
                      isInvalid={true}
                    />
                  ))}
                  {emails.map((email, index) => (
                    <EmailTag
                      key={`valid-${index}`}
                      email={email}
                      onRemove={() => removeEmail(index)}
                      disabled={isSubmitting}
                    />
                  ))}
                  <Input
                    id='emails'
                    type='text'
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    onBlur={() => inputValue.trim() && addEmail(inputValue)}
                    placeholder={
                      emails.length > 0 || invalidEmails.length > 0
                        ? 'Add another email'
                        : 'Enter email addresses (comma or Enter to separate)'
                    }
                    className={cn(
                      'h-7 min-w-[180px] flex-1 border-none py-1 focus-visible:ring-0 focus-visible:ring-offset-0',
                      emails.length > 0 || invalidEmails.length > 0 ? 'pl-1' : 'pl-0'
                    )}
                    autoFocus
                    disabled={isSubmitting}
                  />
                </div>
                <p
                  className={cn(
                    'mt-1 text-xs',
                    errorMessage
                      ? 'text-destructive'
                      : successMessage
                        ? 'text-green-600'
                        : 'text-muted-foreground'
                  )}
                >
                  {errorMessage ||
                    successMessage ||
                    'Press Enter, comma, or space after each email.'}
                </p>
              </div>

              <div className='flex justify-end'>
                <Button
                  type='submit'
                  size='sm'
                  disabled={
                    (emails.length === 0 && !inputValue.trim()) ||
                    isSubmitting ||
                    !activeWorkspaceId
                  }
                  className={cn(
                    'gap-2 font-medium',
                    'bg-[#802FFF] hover:bg-[#7028E6]',
                    'shadow-[0_0_0_0_#802FFF] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]',
                    'text-white transition-all duration-200',
                    'disabled:opacity-50 disabled:hover:bg-[#802FFF] disabled:hover:shadow-none'
                  )}
                >
                  {isSubmitting && <Loader2 className='h-4 w-4 animate-spin' />}
                  {showSent ? 'Sent!' : 'Send Invitations'}
                </Button>
              </div>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
