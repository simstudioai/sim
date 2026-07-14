import { Database } from '@sim/emcn/icons'
import {
  type CodeSegment,
  CodeWindowGraphic,
} from '@/app/(landing)/components/shared/code-window-graphic'

/**
 * A knowledge search step inside an agent's logic - retrieve the passages
 * that ground the answer, then answer from them.
 */
const CODE_LINES: readonly CodeSegment[][] = [
  [
    { text: 'const', tone: 'muted' },
    { text: ' ' },
    { text: 'docs', tone: 'primary' },
    { text: ' ' },
    { text: '= await', tone: 'muted' },
    { text: ' ' },
    { text: 'knowledge', tone: 'primary' },
  ],
  [{ text: '  .search({' }],
  [
    { text: '    ' },
    { text: 'base:', tone: 'muted' },
    { text: ' ' },
    { text: "'Support KB'", tone: 'primary' },
    { text: ',' },
  ],
  [
    { text: '    ' },
    { text: 'query:', tone: 'muted' },
    { text: ' ' },
    { text: 'ticket.question', tone: 'primary' },
    { text: ',' },
  ],
  [{ text: '  })' }],
  [
    { text: 'return', tone: 'muted' },
    { text: ' ' },
    { text: 'agent.answer({ docs })', tone: 'primary' },
  ],
] as const

/**
 * Knowledge retrieval inside agent logic, told in the shared
 * {@link CodeWindowGraphic} editor window: a `Database` mark and the
 * `answer-bot.ts` filename over a knowledge search step retrieving the
 * Support KB passages that ground the agent's answer.
 */
export function KnowledgeQueryGraphic() {
  return (
    <CodeWindowGraphic
      icon={<Database className='size-[14px] text-[var(--text-muted-inverse)]' />}
      filename='answer-bot.ts'
      lines={CODE_LINES}
    />
  )
}
