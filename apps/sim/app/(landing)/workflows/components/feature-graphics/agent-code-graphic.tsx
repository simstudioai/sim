import { FolderCode } from '@sim/emcn/icons'
import {
  type CodeSegment,
  CodeWindowGraphic,
} from '@/app/(landing)/components/shared/code-window-graphic'

/** Supported JavaScript inside a Sim Function block, using an earlier API block's output. */
const CODE_LINES: readonly CodeSegment[][] = [
  [
    { text: 'const ', tone: 'muted' },
    { text: 'data = <api.data>;', tone: 'primary' },
  ],
  [
    { text: 'return ', tone: 'muted' },
    { text: 'data.items', tone: 'primary' },
  ],
  [{ text: '  .filter((item) =>', tone: 'primary' }],
  [{ text: '    item.active)', tone: 'primary' }],
  [{ text: '  .map((item) => item.id);', tone: 'primary' }],
] as const

export function AgentCodeGraphic() {
  return (
    <CodeWindowGraphic
      icon={<FolderCode className='size-[14px] text-[var(--text-muted-inverse)]' />}
      filename='Function · JavaScript'
      lines={CODE_LINES}
    />
  )
}
