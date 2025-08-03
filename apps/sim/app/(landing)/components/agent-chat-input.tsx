"use client"

import React from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Mic, Mail, User, MessageSquare, Check, Send, ArrowUp } from 'lucide-react'
import Link from 'next/link'

const AGENT_OPTIONS = [
  { value: 'voice', label: 'Voice Agent', icon: Mic },
  { value: 'email', label: 'Email Agent', icon: Mail },
  { value: 'leadgen', label: 'LeadGen Agent', icon: User },
  { value: 'chat', label: 'Chat Agent', icon: MessageSquare },
  { value: 'task', label: 'Task Agent', icon: Check },
] as const

export default function AgentChatInput() {
  const handleAgentClick = (agent: typeof AGENT_OPTIONS[number]) => {
    // TODO: Add navigation to platform with selected agent type
    console.log(`Navigating to create ${agent.label}`)
  }

  const handleSendClick = () => {
    // TODO: Add navigation to platform with prompt
    console.log(`Creating agent with prompt`)
  }

  return (
    <div className="flex flex-col gap-2 items-center w-full md:w-auto">
      <div className="gap-2 px-4 hidden md:flex">
        {AGENT_OPTIONS.map((agent) => (
          <Link href={`/agent/${agent.value}`} key={agent.value}>
            <div className="shadow-xs bg-background flex items-center gap-2 rounded-[8px] px-2 py-1.5 sm:py-1.5 transition-all hover:scale-105 border border-input">
              <agent.icon className='h-4 w-4' />
              <span className='text-sm'>{agent.label}</span>
            </div>
          </Link>
        ))}
      </div>

      <div className='relative w-full'>
        <Textarea
          placeholder="Ask me to create a voice agent..."
          className="min-h-[6rem] sm:min-h-[7rem] p-3 sm:p-4 pr-14 sm:pr-16 text-sm sm:text-base border-input rounded-[14px] shadow-xl resize-none placeholder:text-muted-foreground placeholder:text-sm sm:placeholder:text-base focus-visible:ring-1 focus-visible:ring-[#A46FFF] focus-visible:ring-offset-0 focus-visible:border-[#A46FFF] focus-visible:outline-none"
        />
        <Button
          variant='default'
          size='icon'
          onClick={handleSendClick}
          className="bg-gradient-to-b from-[#8A47FF] to-[#6F3DFA] border-[#AC7CFF] border text-white absolute top-2 right-2  rounded-lg shadow-md"
        >
          <ArrowUp className='h-4 w-4' />
        </Button>
      </div>
    </div>
  )
} 