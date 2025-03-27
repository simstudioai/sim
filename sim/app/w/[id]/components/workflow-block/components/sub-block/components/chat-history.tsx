import { useState, useEffect } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useSubBlockValue } from '../hooks/use-sub-block-value'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'function'
  content: string
  name?: string
}

interface ChatHistoryProps {
  blockId: string
  subBlockId: string
}

const ROLE_OPTIONS = [
  { label: 'System', id: 'system' },
  { label: 'User', id: 'user' },
  { label: 'Assistant', id: 'assistant' },
  { label: 'Function', id: 'function' }
]

export function ChatHistory({ blockId, subBlockId }: ChatHistoryProps) {
  const [value, setValue] = useSubBlockValue(blockId, subBlockId)
  const messages: ChatMessage[] = Array.isArray(value) ? value : []
  console.log("Initial messages:", messages)

  useEffect(() => {
    console.log("Messages length:", messages.length)
    if (messages.length === 0) {
      console.log("Setting initial system message")
      setValue([{ role: 'system', content: '' }])
    }
  }, [messages.length, setValue])

  const addMessage = () => {
    setValue([
      ...messages,
      { role: 'user', content: '' }
    ])
  }

  const updateMessage = (index: number, field: keyof ChatMessage, newValue: string) => {
    const newMessages = [...messages]
    newMessages[index] = {
      ...newMessages[index],
      [field]: newValue
    }
    setValue(newMessages)
  }

  const removeMessage = (index: number) => {
    setValue(messages.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-4">
      {messages.map((message, index) => (
        <div key={index} className="flex flex-col gap-2 p-4 rounded-lg bg-muted/30">
          <div className="flex items-center gap-2">
            <Select
              value={message.role}
              onValueChange={(value) => updateMessage(index, 'role', value)}
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            {message.role === 'function' && (
              <Input
                className="w-40 flex-shrink-0"
                value={message.name || ''}
                onChange={(e) => updateMessage(index, 'name', e.target.value)}
                placeholder="Function name..."
              />
            )}
            
            <Button
              variant="ghost"
              size="icon"
              onClick={() => removeMessage(index)}
              className="ml-auto text-gray-500 hover:text-red-600"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          
          <Textarea
            value={message.content}
            onChange={(e) => updateMessage(index, 'content', e.target.value)}
            placeholder={`Enter ${message.role} message...`}
            className="min-h-[100px] resize-y"
          />
        </div>
      ))}
      
      <Button
        variant="outline"
        size="sm"
        onClick={addMessage}
        className="w-full hover:bg-accent hover:text-accent-foreground"
      >
        <Plus className="h-4 w-4 mr-2" />
        Add Message
      </Button>
    </div>
  )
}
