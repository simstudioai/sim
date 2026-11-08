'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { CopyButton } from '@sim/emcn/button/copy-button'
import { InlineNotice } from '@sim/emcn/status'
import { formatDuration } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/format'
import type {
  TracePayload,
  TraceSpan,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/model'
import { MetadataFields } from '@/platform/app/(shell)/workspace/[workspaceId]/logs/_components/metadata-fields/metadata-fields'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/logs/_components/span-inspector/span-inspector.module.css'

const STEP_TYPE: Record<TraceSpan['kind'], string> = {
  agent: 'Agent',
  model: 'Model call',
  tool: 'Tool call',
  mcp: 'MCP tool call',
  loop: 'Loop',
  iteration: 'Loop iteration',
  parallel: 'Parallel',
  branch: 'Parallel branch',
  workflow: 'Workflow',
  block: 'Block',
}

const STEP_STATUS: Record<TraceSpan['status'], string> = {
  success: 'Succeeded',
  error: 'Failed',
  handled: 'Recovered',
  running: 'Running',
}

const FORMAT_LABEL = { json: 'JSON', text: 'Text' } as const

/** Lines a payload shows before the reader asks for the rest, so a large input never buries its output. */
const PREVIEW_LINES = 32

const NOTICE_INTENT = { neutral: 'neutral', warning: 'warning', danger: 'danger' } as const

interface PayloadProps {
  label: string
  payload: TracePayload
}

interface PayloadBodyProps {
  content: string
}

/**
 * The content in the chat tool payload's monospace, one source line at a time so wrapped values keep
 * their indent. A long payload shows its first lines until the reader asks for all of them.
 */
function PayloadBody({ content }: PayloadBodyProps) {
  const [expanded, setExpanded] = useState(false)
  const lines = content.split('\n').map((line, number) => {
    const code = line.trimStart()
    return { number, indent: line.slice(0, line.length - code.length), code }
  })
  const long = lines.length > PREVIEW_LINES
  return (
    <>
      <pre className={styles.body} data-type='T009'>
        {(long && !expanded ? lines.slice(0, PREVIEW_LINES) : lines).map((line) => (
          <span key={line.number} className={styles.line}>
            <span className={styles.indent}>{line.indent}</span>
            <span className={styles.code}>{line.code || ' '}</span>
          </span>
        ))}
      </pre>
      {long && (
        <span className={styles.more}>
          <Button variant='quiet' size='compact' onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Show less' : `Show all ${lines.length.toLocaleString('en-US')} lines`}
          </Button>
        </span>
      )}
    </>
  )
}

/**
 * Paper's trace payload: a caption with the format and a copy action above the content, which has
 * no surface of its own.
 */
function Payload({ label, payload }: PayloadProps) {
  return (
    <section className={styles.payload} aria-label={label}>
      <header className={styles.payloadHeader}>
        <h3 data-type='T051'>{label}</h3>
        {payload.format !== 'withheld' && (
          <span className={styles.payloadActions}>
            <span data-type='T050'>{FORMAT_LABEL[payload.format]}</span>
            <CopyButton label={`Copy ${label.toLowerCase()}`} text={payload.content} />
          </span>
        )}
      </header>
      {payload.format === 'withheld' ? (
        <InlineNotice intent='neutral' title='Content withheld' message={payload.reason} />
      ) : (
        <PayloadBody content={payload.content} />
      )}
    </section>
  )
}

interface SpanInspectorProps {
  span: TraceSpan
}

/** The selected step: what it was, how it went, the context it ran in and what it read and wrote. */
export function SpanInspector({ span }: SpanInspectorProps) {
  return (
    <section className={styles.inspector} aria-label={`${span.name} step`}>
      <h2 className={styles.heading} data-type='T093'>
        {span.name}
      </h2>
      <MetadataFields
        label={`${span.name} facts`}
        fields={[
          { id: 'type', label: 'Step type', value: STEP_TYPE[span.kind] },
          { id: 'status', label: 'Status', value: STEP_STATUS[span.status] },
          { id: 'duration', label: 'Duration', value: formatDuration(span.durationMs) },
          ...span.context,
        ]}
      />
      {span.notice && (
        <InlineNotice
          intent={NOTICE_INTENT[span.notice.tone]}
          title={span.notice.title}
          message={span.notice.message}
        />
      )}
      {span.input && <Payload label='Input' payload={span.input} />}
      {span.output && <Payload label='Output' payload={span.output} />}
    </section>
  )
}
