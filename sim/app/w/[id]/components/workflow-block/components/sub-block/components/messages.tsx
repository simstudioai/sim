import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useSubBlockValue } from '../hooks/use-sub-block-value'

interface Message {
  id: string
  role: 'system' | 'user' | 'assistant'
  content: string
  name?: string
}

interface MessagesProps {
  blockId: string
  subBlockId: string
}

const ROLE_OPTIONS = [
  { label: 'System', id: 'system' },
  { label: 'User', id: 'user' },
  { label: 'Assistant', id: 'assistant' },
]

export function Messages({ blockId, subBlockId }: MessagesProps) {
  const [value, setValue] = useSubBlockValue(blockId, subBlockId)
  const [openPopoverIds, setOpenPopoverIds] = useState<Set<string>>(new Set())

  // Ensure messages have IDs
  const ensureMessageIds = (messages: any[]): Message[] => {
    if (!Array.isArray(messages)) return []

    return messages.map((msg) => ({
      id: msg.id || crypto.randomUUID(),
      role: msg.role || 'user',
      content: msg.content || '',
      name: msg.name,
    }))
  }

  const messages = ensureMessageIds(value)

  useEffect(() => {
    if (messages.length === 0) {
      setValue([
        {
          id: crypto.randomUUID(),
          role: 'system',
          content: '',
        },
      ])
    }
  }, [messages.length, setValue])

  const addMessage = (afterId: string) => {
    const messageIndex = messages.findIndex((msg) => msg.id === afterId)
    const newMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: '',
    }

    const newMessages = [...messages]
    newMessages.splice(messageIndex + 1, 0, newMessage)
    setValue(newMessages)
  }

  const updateMessage = (id: string, field: keyof Message, newValue: string) => {
    setValue(messages.map((msg) => (msg.id === id ? { ...msg, [field]: newValue } : msg)))
  }

  const removeMessage = (id: string) => {
    // Prevent removing the last message
    if (messages.length <= 1) return
    setValue(messages.filter((msg) => msg.id !== id))
  }

  const moveMessage = (id: string, direction: 'up' | 'down') => {
    const messageIndex = messages.findIndex((msg) => msg.id === id)
    if (
      (direction === 'up' && messageIndex === 0) ||
      (direction === 'down' && messageIndex === messages.length - 1)
    )
      return

    const newMessages = [...messages]
    const targetIndex = direction === 'up' ? messageIndex - 1 : messageIndex + 1
    ;[newMessages[messageIndex], newMessages[targetIndex]] = [
      newMessages[targetIndex],
      newMessages[messageIndex],
    ]
    setValue(newMessages)
  }

  const togglePopover = (id: string, isOpen: boolean) => {
    setOpenPopoverIds((prev) => {
      const newSet = new Set(prev)
      if (isOpen) {
        newSet.add(id)
      } else {
        newSet.delete(id)
      }
      return newSet
    })
  }

  const handleRoleChange = (id: string, role: string) => {
    updateMessage(id, 'role', role)
    togglePopover(id, false)
  }

  const getRoleLabel = (role: string) => {
    return ROLE_OPTIONS.find((option) => option.id === role)?.label || role
  }

  return (
    <div className="space-y-4">
      {messages.map((message, index) => (
        <Card
          key={message.id}
          className="overflow-visible rounded-lg border bg-background group relative shadow-none"
        >
          <div className="flex h-10 items-center justify-between bg-card pl-1 pr-3 rounded-t-lg border-b">
            <div className="flex items-center gap-2">
              <Popover
                open={openPopoverIds.has(message.id)}
                onOpenChange={(open) => togglePopover(message.id, open)}
              >
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 gap-1">
                    <span className="capitalize">{getRoleLabel(message.role)}</span>
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-36 p-1" align="start">
                  <div className="text-sm">
                    {ROLE_OPTIONS.map((option) => (
                      <div
                        key={option.id}
                        className={cn(
                          'px-2 py-1.5 rounded-md cursor-pointer hover:bg-accent/50 transition-colors duration-150',
                          message.role === option.id && 'bg-accent'
                        )}
                        onClick={() => handleRoleChange(message.id, option.id)}
                      >
                        {option.label}
                      </div>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => addMessage(message.id)}
                    className="h-8 w-8"
                  >
                    <Plus className="h-4 w-4" />
                    <span className="sr-only">Add Message</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Add Message</TooltipContent>
              </Tooltip>

              <div className="flex items-center">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => moveMessage(message.id, 'up')}
                      disabled={index === 0}
                      className="h-8 w-8"
                    >
                      <ChevronUp className="h-4 w-4" />
                      <span className="sr-only">Move Up</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Move Up</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => moveMessage(message.id, 'down')}
                      disabled={index === messages.length - 1}
                      className="h-8 w-8"
                    >
                      <ChevronDown className="h-4 w-4" />
                      <span className="sr-only">Move Down</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Move Down</TooltipContent>
                </Tooltip>
              </div>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeMessage(message.id)}
                    disabled={messages.length <= 1}
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="sr-only">Delete Message</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Delete Message</TooltipContent>
              </Tooltip>
            </div>
          </div>

          <div className="p-3 space-y-3 bg-background rounded-b-lg">
            <div className="space-y-1.5 relative">
              <div className="text-xs font-medium text-muted-foreground">Content</div>
              <Textarea
                value={message.content}
                onChange={(e) => updateMessage(message.id, 'content', e.target.value)}
                placeholder={`Enter ${message.role} message content...`}
                className="min-h-[100px] resize-y w-full"
              />
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}
