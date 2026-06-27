import type { SVGProps } from 'react'
import { createElement } from 'react'
import { MessageCircle } from 'lucide-react'
import type { BlockDisplay } from '@/blocks/manifest'

const ChatTriggerIcon = (props: SVGProps<SVGSVGElement>) => createElement(MessageCircle, props)

export const ChatTriggerBlockDisplay = {
  type: 'chat_trigger',
  name: 'Chat',
  description: 'Legacy chat start block. Prefer the unified Start block.',
  category: 'triggers',
  bgColor: '#6F3DFA',
  icon: ChatTriggerIcon,
  longDescription: 'Chat trigger to run the workflow via deployed chat interfaces.',
  hideFromToolbar: true,
  triggerAllowed: true,
} satisfies BlockDisplay
