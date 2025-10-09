import type { SVGProps } from 'react'
import { createElement } from 'react'
import { MessageCircle } from 'lucide-react'
import type { BlockConfig } from '@/blocks/types'

const ChatTriggerIcon = (props: SVGProps<SVGSVGElement>) => createElement(MessageCircle, props)

export const ChatTriggerBlock: BlockConfig = {
  type: 'chat_trigger',
  triggerAllowed: true,
  name: 'Chat',
  description: 'Start workflow from a chat deployment',
  longDescription: 'Chat trigger to run the workflow via deployed chat interfaces.',
  bestPractices: `
  - Can run the workflow manually to test implementation when this is the trigger point by passing in a message.
  `,
  category: 'triggers',
  bgColor: '#6F3DFA',
  icon: ChatTriggerIcon,
  subBlocks: [],
  tools: {
    access: [],
  },
  inputs: {},
  outputs: {
    input: { type: 'string', description: 'User message' },
    conversationId: { type: 'string', description: 'Conversation ID' },
    files: { type: 'files', description: 'Uploaded files' },
  },
  triggers: {
    enabled: true,
    available: ['chat'],
  },
}
