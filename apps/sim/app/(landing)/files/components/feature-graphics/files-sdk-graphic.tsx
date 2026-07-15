import { File } from '@sim/emcn/icons'
import {
  type CodeSegment,
  CodeWindowGraphic,
} from '@/app/(landing)/components/shared/code-window-graphic'

/**
 * The `report-agent.ts` excerpt — an agent reading a file from the shared
 * store and writing its output back, the page's story reached from code.
 */
const CODE_LINES: readonly CodeSegment[][] = [
  [
    { text: 'import', tone: 'muted' },
    { text: ' ' },
    { text: '{ files }', tone: 'primary' },
    { text: ' ' },
    { text: 'from', tone: 'muted' },
    { text: ' ' },
    { text: "'@sim/sdk'", tone: 'primary' },
  ],
  [
    { text: 'const', tone: 'muted' },
    { text: ' ' },
    { text: 'brief', tone: 'primary' },
    { text: ' ' },
    { text: '= await', tone: 'muted' },
  ],
  [{ text: '  ' }, { text: "files.read('q3-brief.pdf')", tone: 'primary' }],
  [{ text: 'await', tone: 'muted' }, { text: ' ' }, { text: 'files.upload({', tone: 'primary' }],
  [
    { text: '  ' },
    { text: 'name:', tone: 'muted' },
    { text: ' ' },
    { text: "'weekly-report.pdf'", tone: 'primary' },
    { text: ',' },
  ],
  [
    { text: '  ' },
    { text: 'content:', tone: 'muted' },
    { text: ' ' },
    { text: 'draft(brief)', tone: 'primary' },
    { text: ',' },
  ],
] as const

/**
 * Files reached from code told in the shared {@link CodeWindowGraphic}
 * editor window: the `File` mark and the `report-agent.ts` filename over
 * an SDK excerpt reading a brief out of Sim's file store and uploading
 * the finished report back.
 */
export function FilesSdkGraphic() {
  return (
    <CodeWindowGraphic
      icon={<File className='size-[14px] text-[var(--text-muted-inverse)]' />}
      filename='report-agent.ts'
      lines={CODE_LINES}
    />
  )
}
