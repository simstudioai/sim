import type { SVGProps } from 'react'
import { createElement } from 'react'
import { MessageCircle } from 'lucide-react'
import { ChatTriggerBlockDisplay } from '@/blocks/blocks/chat_trigger.display'
import type { BlockConfig } from '@/blocks/types'

const ChatTriggerIcon = (props: SVGProps<SVGSVGElement>) => createElement(MessageCircle, props)

export const ChatTriggerBlock: BlockConfig = {
  ...ChatTriggerBlockDisplay,
  bestPractices: `
  - Can run the workflow manually to test implementation when this is the trigger point by passing in a message.
  `,
  subBlocks: [],
  tools: {
    access: [],
  },
  inputs: {},
  outputs: {
    input: { type: 'string', description: 'User message' },
    conversationId: { type: 'string', description: 'Conversation ID' },
    files: { type: 'file[]', description: 'Uploaded files' },
  },
  triggers: {
    enabled: true,
    available: ['chat'],
  },
}
