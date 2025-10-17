import { MessagesIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { MessageTesterResponse } from '@/tools/message_tester/types'

export const MessageTesterBlock: BlockConfig<MessageTesterResponse> = {
  type: 'messageTester',
  name: 'Message Tester',
  description: 'Test message effectiveness with target audience analysis',
  longDescription: 'Analyze how your message will be received by specific target demographics and regions.',
  docsLink: 'https://docs.sim.ai/tools/message-tester',
  category: 'tools',
  bgColor: '#4A90E2',
  icon: MessagesIcon,
  subBlocks: [
    {
      id: 'objective',
      title: 'Objective',
      type: 'short-input',
      layout: 'full',
      required: true,
      placeholder: 'Enter the objective',
    },
    {
      id: 'region',
      title: 'Region',
      type: 'short-input',
      layout: 'full',
      required: true,
      placeholder: 'Enter the region',
    },
    {
      id: 'targetAudience',
      title: 'Target Audience',
      type: 'short-input',
      layout: 'full',
      required: true,
      placeholder: 'Enter the target audience',
    },
    {
      id: 'message',
      title: 'Message',
      type: 'long-input',
      layout: 'full',
      required: true,
      placeholder: 'Enter your message to test',
    },
  ],
  tools: {
    access: ['message_tester_execute'],
  },
  inputs: {
    objective: { type: 'string', description: 'Message testing objective' },
    region: { type: 'string', description: 'Target region' },
    targetAudience: { type: 'string', description: 'Target audience' },
    message: { type: 'string', description: 'Message content to test' },
  },
  outputs: {
    content: { type: 'string', description: 'Message testing results' },
  },
}