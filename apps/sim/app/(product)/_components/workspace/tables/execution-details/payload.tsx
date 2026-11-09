'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { CopyButton } from '@sim/emcn/button/copy-button'
import { Disclosure } from '@sim/emcn/disclosure'
import styles from '@/app/(product)/_components/workspace/tables/execution-details/execution-details.module.css'

/** Lines a payload shows before the reader asks for the rest, so a large input never buries what follows. */
const PREVIEW_LINES = 32

function payloadText(data: unknown): string {
  if (data == null) return ''
  if (typeof data === 'string') return data
  return JSON.stringify(data, null, 2)
}

/**
 * The content in monospace, one source line at a time so a wrapped value keeps its indent. A long
 * payload shows its first lines until the reader asks for all of them.
 */
function PayloadBody({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)
  const lines = content.split('\n').map((line, number) => {
    const code = line.trimStart()
    return { number, indent: line.slice(0, line.length - code.length), code }
  })
  const long = lines.length > PREVIEW_LINES
  return (
    <>
      <pre className={styles.payloadBody} data-type='T009'>
        {(long && !expanded ? lines.slice(0, PREVIEW_LINES) : lines).map((line) => (
          <span key={line.number} className={styles.payloadLine}>
            <span className={styles.payloadIndent}>{line.indent}</span>
            <span className={styles.payloadCode}>{line.code || ' '}</span>
          </span>
        ))}
      </pre>
      {long && (
        <span className={styles.payloadMore}>
          <Button variant='quiet' size='compact' onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Show less' : `Show all ${lines.length.toLocaleString('en-US')} lines`}
          </Button>
        </span>
      )}
    </>
  )
}

interface PayloadProps {
  label: string
  data: unknown
}

/**
 * A run's or step's data under a caption that opens and closes it, with a copy action beside the
 * caption.
 */
export function Payload({ label, data }: PayloadProps) {
  const content = payloadText(data)
  return (
    <Disclosure
      label={label}
      initiallyOpen
      actions={<CopyButton label={`Copy ${label.toLowerCase()}`} text={content} size='compact' />}
    >
      <div className={styles.payload}>
        <PayloadBody content={content} />
      </div>
    </Disclosure>
  )
}
