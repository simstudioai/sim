'use client'

import { useMemo, useState } from 'react'
import { Badge, Button, Input, Label } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  getApiReferenceBlockContract,
  getApiReferenceTraceContract,
  type JsonSchemaNode,
  listApiReferenceBlocksContract,
  type OrgResourceApi,
} from '@/lib/api/contracts/api-reference'

interface ResourceTestPanelProps {
  resource: OrgResourceApi
}

/** Coerces a raw string field value to the JSON type the schema declares. */
function coerceValue(raw: string, node: JsonSchemaNode): unknown {
  if (raw.trim() === '') return undefined
  switch (node.type) {
    case 'number':
      return Number(raw)
    case 'boolean':
      return raw === 'true'
    case 'object':
    case 'array':
      try {
        return JSON.parse(raw)
      } catch {
        return raw
      }
    default:
      return raw
  }
}

/** Pretty-prints a value (or a JSON string) for display. */
function pretty(value: unknown): string {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2)
    } catch {
      return value
    }
  }
  return JSON.stringify(value, null, 2)
}

function ResultBox({ status, body }: { status?: number; body: string }) {
  return (
    <div className='flex flex-col gap-1'>
      {status != null && (
        <Badge variant='type' size='sm'>
          HTTP {status}
        </Badge>
      )}
      <pre className='max-h-64 overflow-auto rounded-md bg-[var(--surface-4)] p-3 text-[var(--text-secondary)] text-caption'>
        {body}
      </pre>
    </div>
  )
}

/**
 * An interactive explorer for every operation an endpoint exposes: always **Invoke**,
 * plus **Get trace** (supply the `executionId` an invoke returns) when the provider
 * exposed traces, and **Blocks** (list, or get one by `blockId`) when the provider
 * exposed block introspection. Invoke hits the real external invoke endpoint (public or
 * api-key auth); trace/block calls use your own session against the org-member routes.
 */
export function ResourceTestPanel({ resource }: ResourceTestPanelProps) {
  const fields = useMemo(
    () => Object.entries(resource.input.properties ?? {}),
    [resource.input.properties]
  )
  const requiredFields = useMemo(() => new Set(resource.input.required ?? []), [resource.input])
  const needsKey = resource.auth.type === 'api_key'
  const traceExposed = resource.exposure.trace === 'traceId'
  const blocksExposed = resource.exposure.blocks

  const [values, setValues] = useState<Record<string, string>>({})
  const [apiKey, setApiKey] = useState('')
  const [invoke, setInvoke] = useState<{
    loading: boolean
    status?: number
    body?: string
    error?: string
  }>({
    loading: false,
  })

  const [traceExecId, setTraceExecId] = useState('')
  const [trace, setTrace] = useState<{ loading: boolean; body?: string; error?: string }>({
    loading: false,
  })

  const [blocks, setBlocks] = useState<{ loading: boolean; body?: string; error?: string }>({
    loading: false,
  })
  const [blockId, setBlockId] = useState('')
  const [block, setBlock] = useState<{ loading: boolean; body?: string; error?: string }>({
    loading: false,
  })

  const setField = (name: string, value: string) =>
    setValues((prev) => ({ ...prev, [name]: value }))

  const runInvoke = async () => {
    setInvoke({ loading: true })
    try {
      const body: Record<string, unknown> = {}
      for (const [name, node] of fields) {
        const coerced = coerceValue(values[name] ?? '', node)
        if (coerced !== undefined) body[name] = coerced
      }
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (needsKey && apiKey.trim()) headers['x-api-key'] = apiKey.trim()

      // boundary-raw-fetch: user-driven "Try it out" call to an arbitrary published
      // workflow's invoke endpoint with a user-supplied body and auth header - not a
      // typed contract, and cross-workspace by design.
      const response = await fetch(resource.invokeUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const text = await response.text()
      setInvoke({ loading: false, status: response.status, body: pretty(text) })

      // Capture the returned executionId so "Get trace" is one click away.
      try {
        const parsed = JSON.parse(text) as { executionId?: unknown }
        if (typeof parsed.executionId === 'string') setTraceExecId(parsed.executionId)
      } catch {
        /* non-JSON response - nothing to prefill */
      }
    } catch (err) {
      setInvoke({ loading: false, error: getErrorMessage(err, 'Request failed') })
    }
  }

  const runTrace = async () => {
    setTrace({ loading: true })
    try {
      const data = await requestJson(getApiReferenceTraceContract, {
        params: {
          id: resource.workspaceId,
          workflowId: resource.workflowId,
          executionId: traceExecId.trim(),
        },
      })
      setTrace({ loading: false, body: pretty(data) })
    } catch (err) {
      setTrace({ loading: false, error: getErrorMessage(err, 'Could not fetch trace') })
    }
  }

  const runListBlocks = async () => {
    setBlocks({ loading: true })
    try {
      const data = await requestJson(listApiReferenceBlocksContract, {
        params: { id: resource.workspaceId, workflowId: resource.workflowId },
      })
      setBlocks({ loading: false, body: pretty(data.blocks) })
    } catch (err) {
      setBlocks({ loading: false, error: getErrorMessage(err, 'Could not list blocks') })
    }
  }

  const runGetBlock = async () => {
    setBlock({ loading: true })
    try {
      const data = await requestJson(getApiReferenceBlockContract, {
        params: {
          id: resource.workspaceId,
          workflowId: resource.workflowId,
          blockId: blockId.trim(),
        },
      })
      setBlock({ loading: false, body: pretty(data.block) })
    } catch (err) {
      setBlock({ loading: false, error: getErrorMessage(err, 'Could not fetch block') })
    }
  }

  return (
    <div className='mt-3 flex flex-col gap-4 border-[var(--border-1)] border-t pt-3'>
      {/* Invoke */}
      <section className='flex flex-col gap-2'>
        <div className='font-medium text-[var(--text-primary)] text-caption'>Invoke</div>
        {fields.map(([name, node]) => (
          <div key={name} className='flex flex-col gap-1'>
            <Label className='text-caption'>
              {name}
              <span className='ml-1 text-[var(--text-tertiary)]'>({node.type})</span>
              {requiredFields.has(name) && (
                <span className='ml-1 text-[var(--text-tertiary)]'>· required</span>
              )}
            </Label>
            <Input
              value={values[name] ?? ''}
              onChange={(e) => setField(name, e.target.value)}
              placeholder={
                node.type === 'object' || node.type === 'array' ? 'JSON value' : `Enter ${name}`
              }
            />
          </div>
        ))}
        {needsKey && (
          <div className='flex flex-col gap-1'>
            <Label className='text-caption'>
              x-api-key
              <span className='ml-1 text-[var(--text-tertiary)]'>· required for this endpoint</span>
            </Label>
            <Input
              type='password'
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder='Paste a Sim API key with access to the providing workspace'
            />
          </div>
        )}
        <div>
          <Button variant='tertiary' onClick={runInvoke} disabled={invoke.loading}>
            {invoke.loading ? 'Sending...' : 'Send request'}
          </Button>
        </div>
        {invoke.error && (
          <div className='text-[var(--text-error,red)] text-caption'>{invoke.error}</div>
        )}
        {invoke.body != null && <ResultBox status={invoke.status} body={invoke.body} />}
      </section>

      {/* Get trace - only when the provider exposed it */}
      {traceExposed && (
        <section className='flex flex-col gap-2 border-[var(--border-1)] border-t pt-3'>
          <div className='font-medium text-[var(--text-primary)] text-caption'>
            Get execution trace
          </div>
          <div className='flex flex-col gap-1'>
            <Label className='text-caption'>
              executionId
              <span className='ml-1 text-[var(--text-tertiary)]'>· from an invoke response</span>
            </Label>
            <Input
              value={traceExecId}
              onChange={(e) => setTraceExecId(e.target.value)}
              placeholder='Run Invoke above to auto-fill, or paste an executionId'
            />
          </div>
          <div>
            <Button
              variant='default'
              onClick={runTrace}
              disabled={trace.loading || !traceExecId.trim()}
            >
              {trace.loading ? 'Fetching...' : 'Fetch trace'}
            </Button>
          </div>
          {trace.error && (
            <div className='text-[var(--text-error,red)] text-caption'>{trace.error}</div>
          )}
          {trace.body != null && <ResultBox body={trace.body} />}
        </section>
      )}

      {/* Blocks - only when the provider exposed introspection */}
      {blocksExposed && (
        <section className='flex flex-col gap-2 border-[var(--border-1)] border-t pt-3'>
          <div className='font-medium text-[var(--text-primary)] text-caption'>Blocks</div>
          <div className='flex flex-wrap items-end gap-2'>
            <Button variant='default' onClick={runListBlocks} disabled={blocks.loading}>
              {blocks.loading ? 'Loading...' : 'List blocks'}
            </Button>
          </div>
          {blocks.error && (
            <div className='text-[var(--text-error,red)] text-caption'>{blocks.error}</div>
          )}
          {blocks.body != null && <ResultBox body={blocks.body} />}

          <div className='flex flex-col gap-1'>
            <Label className='text-caption'>blockId</Label>
            <Input
              value={blockId}
              onChange={(e) => setBlockId(e.target.value)}
              placeholder='A block id from the list above'
            />
          </div>
          <div>
            <Button
              variant='default'
              onClick={runGetBlock}
              disabled={block.loading || !blockId.trim()}
            >
              {block.loading ? 'Fetching...' : 'Get block'}
            </Button>
          </div>
          {block.error && (
            <div className='text-[var(--text-error,red)] text-caption'>{block.error}</div>
          )}
          {block.body != null && <ResultBox body={block.body} />}
        </section>
      )}
    </div>
  )
}
