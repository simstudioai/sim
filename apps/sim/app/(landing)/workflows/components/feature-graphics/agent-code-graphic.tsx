import { FolderCode } from '@sim/emcn/icons'
import {
  type CodeSegment,
  CodeWindowGraphic,
} from '@/app/(landing)/components/shared/code-window-graphic'

/**
 * The `support-agent.ts` excerpt the build-methods tile types out,
 * rendered settled — the same agent, reached from code.
 */
const CODE_LINES: readonly CodeSegment[][] = [
  [
    { text: 'import', tone: 'muted' },
    { text: ' ' },
    { text: '{ agent }', tone: 'primary' },
    { text: ' ' },
    { text: 'from', tone: 'muted' },
    { text: ' ' },
    { text: "'@sim/sdk'", tone: 'primary' },
  ],
  [
    { text: 'const', tone: 'muted' },
    { text: ' ' },
    { text: 'supportAgent', tone: 'primary' },
    { text: ' ' },
    { text: '= await', tone: 'muted' },
    { text: ' ' },
    { text: 'agent', tone: 'primary' },
  ],
  [{ text: '  .workflow({' }],
  [
    { text: '    ' },
    { text: 'name:', tone: 'muted' },
    { text: ' ' },
    { text: "'Support agent'", tone: 'primary' },
    { text: ',' },
  ],
  [
    { text: '    ' },
    { text: 'tools:', tone: 'muted' },
    { text: ' ' },
    { text: '[zendesk, slack]', tone: 'primary' },
    { text: ',' },
  ],
  [{ text: '  })' }],
] as const

/**
 * Code-first building told in the shared {@link CodeWindowGraphic} editor
 * window: the `FolderCode` mark and the `support-agent.ts` filename over
 * the same SDK excerpt the build-methods tile types out, sitting settled
 * so the two tiles read as the same file at rest and mid-write.
 */
export function AgentCodeGraphic() {
  return (
    <CodeWindowGraphic
      icon={<FolderCode className='size-[14px] text-[var(--text-muted-inverse)]' />}
      filename='support-agent.ts'
      lines={CODE_LINES}
    />
  )
}
