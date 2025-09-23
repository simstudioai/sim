import type { SVGProps } from 'react'
import { createElement } from 'react'
import { MessageCircle } from 'lucide-react'
import type { BlockConfig } from '@/blocks/types'

const ChatTriggerIcon = (props: SVGProps<SVGSVGElement>) => createElement(MessageCircle, props)

export const ChatTriggerBlock: BlockConfig = {
  type: 'chat_trigger',
  name: 'Chat',
  description: 'Start workflow from a chat deployment',
  longDescription: 'Chat trigger to run the workflow via deployed chat interfaces.',
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
    files: { type: 'array', description: 'Uploaded files' },
  },
  triggers: {
    enabled: true,
    available: ['chat'],
  },
}
