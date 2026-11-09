'use client'

import { useState } from 'react'
import { CopyButton } from '@sim/emcn/button/copy-button'
import { EmptyState } from '@sim/emcn/empty-state'
import { FieldFrame, TextAreaField } from '@sim/emcn/field'
import { CopyField } from '@sim/emcn/field/value-fields'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import { omit } from '@sim/utils/object'
import { CodeField } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/code-field/code-field'
import { highlightSyntax } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/code-field/highlight'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/deploy/api-tab/api-tab.module.css'
import { OutputPicker } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/deploy/output-picker/output-picker'
import {
  AGENT_STREAM_PROTOCOL_HEADER_LABEL,
  AGENT_STREAM_PROTOCOL_V1,
  getInputFormatExample,
} from '@/platform/lib/data/workflow-deploy'
import { getBaseUrl, useWorkflowStore } from '@/platform/lib/data/workflows'

type ResponseMode = 'sync' | 'stream' | 'async'

/** The Start block's example input as the v2 execute body: `{ input }`. */
function inputPayload(): Record<string, unknown> {
  const example = getInputFormatExample(false)
  const match = example.match(/-d\s*'([\s\S]*)'/)
  if (!match) return { input: {} }
  const parsed = JSON.parse(match[1]) as Record<string, unknown>
  return { input: omit(parsed, ['stream', 'selectedOutputs']) }
}

interface ApiTabProps {
  workflowId: string
  isDeployed: boolean
  isLoading: boolean
  isPublicApi: boolean
  selectedOutputs: readonly string[]
  onSelectedOutputsChange: (outputs: string[]) => void
}

/**
 * The API tab: the execute endpoint, the headers and body a call sends for a synchronous,
 * streamed or asynchronous run, and the outputs a stream returns. Keys and the API's access live
 * in the dialog's footer actions.
 */
export function ApiTab({
  workflowId,
  isDeployed,
  isLoading,
  isPublicApi,
  selectedOutputs,
  onSelectedOutputsChange,
}: ApiTabProps) {
  const [mode, setMode] = useState<ResponseMode>('sync')
  // Thinking and tool frames come off an Agent block's stream sink, whatever outputs are selected.
  const hasAgentBlock = useWorkflowStore((state) =>
    Object.values(state.blocks).some((block) => block.type === 'agent')
  )

  if (isLoading) return null
  if (!isDeployed)
    return (
      <EmptyState
        title='Not deployed'
        description='Deploy your workflow to call it through the API.'
      />
    )

  const responseMode: ResponseMode = isPublicApi && mode === 'async' ? 'sync' : mode
  const endpoint = `${getBaseUrl()}/api/v2/workflows/${workflowId}/execute`
  const statusEndpoint = `${endpoint.slice(0, -'/execute'.length)}/runs/RUN_ID_FROM_EXECUTION?includeOutput=true`
  const usageEndpoint = `${getBaseUrl()}/api/users/me/usage-limits`
  const base = inputPayload()
  const payload =
    responseMode === 'stream'
      ? {
          ...base,
          stream: true,
          ...(selectedOutputs.length > 0 ? { selectedOutputs } : {}),
          ...(hasAgentBlock ? { includeThinking: true, includeToolCalls: true } : {}),
        }
      : responseMode === 'async'
        ? { ...base, async: true }
        : base
  const headers = [
    ...(isPublicApi ? [] : ['X-API-Key: $SIM_API_KEY']),
    ...(responseMode === 'stream' && hasAgentBlock
      ? [`${AGENT_STREAM_PROTOCOL_HEADER_LABEL}: ${AGENT_STREAM_PROTOCOL_V1}`]
      : []),
    'Content-Type: application/json',
  ].join('\n')
  const body = JSON.stringify(payload, null, 2)

  return (
    <div className={styles.form}>
      <FieldFrame label='Response'>
        <SegmentedControl
          label='Response mode'
          options={[
            { value: 'sync', label: 'Synchronous' },
            { value: 'stream', label: 'Streaming' },
            ...(isPublicApi ? [] : [{ value: 'async' as const, label: 'Asynchronous' }]),
          ]}
          value={responseMode}
          onSelect={setMode}
          holdOnReselect
        />
      </FieldFrame>
      <CopyField label='Endpoint' value={endpoint} hint='POST' />
      <TextAreaField
        label='Headers'
        placeholder='Headers'
        value={headers}
        viewOnly
        defaultSize='regular'
      />
      {responseMode === 'stream' && (
        <OutputPicker
          workflowId={workflowId}
          label='Streamed outputs'
          value={selectedOutputs}
          onValueChange={onSelectedOutputsChange}
          valueMode='label'
        />
      )}
      <FieldFrame label='Body'>
        <CodeField
          value={body}
          onValueChange={() => {}}
          highlight={(code) => highlightSyntax(code, 'json')}
          label='Request body'
          readOnly
          lineNumbers={false}
          actions={<CopyButton label='Copy body' text={body} size='compact' />}
        />
      </FieldFrame>
      {responseMode === 'async' && (
        <>
          <CopyField
            label='Status endpoint'
            value={statusEndpoint}
            hint='GET, with the run ID the execution returns'
          />
          <CopyField label='Usage limits' value={usageEndpoint} hint='GET' />
        </>
      )}
    </div>
  )
}
