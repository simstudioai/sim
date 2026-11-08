'use client'

import { CopyButton } from '@sim/emcn/button/copy-button'
import { PropertyList } from '@sim/emcn/property-list'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { InlineNotice } from '@sim/emcn/status'
import { formatDuration } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/format'
import type {
  TracePayload,
  TraceSpan,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/model'
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

const NOTICE_INTENT = { neutral: 'neutral', warning: 'warning', danger: 'danger' } as const

interface PayloadProps {
  label: string
  payload: TracePayload
}

/** A step's input or output in the chat tool-response style, with its own copy action. */
function Payload({ label, payload }: PayloadProps) {
  const edges = useScrollEdges<HTMLPreElement>('vertical')
  return (
    <section className={styles.payload} aria-label={label}>
      <h3 className={styles.payloadHeading} data-type='T051'>
        {label}
        {payload.format !== 'withheld' && (
          <CopyButton label={`Copy ${label.toLowerCase()}`} text={payload.content} />
        )}
      </h3>
      {payload.format === 'withheld' ? (
        <InlineNotice intent='neutral' title='Content withheld' message={payload.reason} />
      ) : (
        <pre
          ref={edges}
          className={styles.body}
          data-type={payload.format === 'json' ? 'T009' : 'T048'}
        >
          {payload.content}
        </pre>
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
      <h2 className={styles.heading} data-type='T042'>
        {span.name}
      </h2>
      <PropertyList
        title={`${span.name} facts`}
        titleHidden
        properties={[
          { id: 'type', label: 'Step type', kind: 'text', value: STEP_TYPE[span.kind] },
          { id: 'status', label: 'Status', kind: 'text', value: STEP_STATUS[span.status] },
          {
            id: 'duration',
            label: 'Duration',
            kind: 'text',
            value: formatDuration(span.durationMs),
          },
          ...span.context.map((field) => ({
            id: field.id,
            label: field.label,
            kind: 'text' as const,
            value: field.value,
          })),
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
