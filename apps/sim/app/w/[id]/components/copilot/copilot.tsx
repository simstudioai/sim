'use client'

import { useState } from 'react'
import { MessageCircle, Send, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useCopilotStore } from '@/stores/copilot/store'

export function Copilot() {
  const { sendMessage } = useCopilotStore()
  const [isOpen, setIsOpen] = useState(false)
  const [message, setMessage] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!message.trim()) return

    await sendMessage(message)
    setMessage('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit(e as unknown as React.FormEvent)
    }
  }

  if (!isOpen) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => setIsOpen(true)}
            className="fixed right-16 bottom-[18px] z-10 flex h-9 w-9 items-center justify-center rounded-lg bg-background text-muted-foreground transition-colors hover:text-foreground hover:bg-accent border"
          >
            <MessageCircle className="h-5 w-5" />
            <span className="sr-only">Open Chat</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">Open Chat</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 w-[50%] max-w-[500px] min-w-[280px] bg-background rounded-2xl border shadow-lg">
      <form onSubmit={handleSubmit} className="flex items-center gap-2 p-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsOpen(false)}
          className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent/50"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close Chat</span>
        </Button>
        <Input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your message..."
          className="flex-1 rounded-xl border-0 focus-visible:ring-0 focus-visible:ring-offset-0 text-sm text-foreground placeholder:text-muted-foreground/50"
        />
        <Button
          type="submit"
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent/50"
        >
          <Send className="h-4 w-4" />
          <span className="sr-only">Send message</span>
        </Button>
      </form>
    </div>
  )
}
