'use client'

import { useCallback, useMemo, useState } from 'react'
import { Badge, Button, Input as EmcnInput, Label, Skeleton } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import {
  type MothershipEnv,
  useGenerateLicense,
  useMothershipEnterpriseStats,
  useMothershipLicenses,
  useMothershipRequests,
  useMothershipTrace,
  useMothershipUserBreakdown,
} from '@/hooks/queries/mothership-admin'

type Tab = 'overview' | 'licenses' | 'enterprise' | 'traces'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'licenses', label: 'Licenses' },
  { id: 'enterprise', label: 'Enterprise' },
  { id: 'traces', label: 'Traces' },
]

const ENV_OPTIONS: { id: MothershipEnv; label: string }[] = [
  { id: 'dev', label: 'Dev' },
  { id: 'staging', label: 'Staging' },
  { id: 'prod', label: 'Prod' },
]

function defaultTimeRange() {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - 7)
  return {
    start: start.toISOString().slice(0, 16),
    end: end.toISOString().slice(0, 16),
  }
}

function toRFC3339(local: string) {
  if (!local) return ''
  return new Date(local).toISOString()
}

function formatCost(cost: number) {
  return `$${cost.toFixed(4)}`
}

function formatDate(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d).toLocaleString()
}

function Divider() {
  return <div className='h-px bg-[var(--border-secondary)]' />
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className='font-medium text-[var(--text-primary)] text-sm'>{children}</p>
}

export function Mothership() {
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [environment, setEnvironment] = useState<MothershipEnv>('dev')
  const defaults = useMemo(() => defaultTimeRange(), [])
  const [start, setStart] = useState(defaults.start)
  const [end, setEnd] = useState(defaults.end)

  return (
    <div className='flex h-full flex-col gap-5'>
      {/* Environment selector */}
      <div className='flex items-center gap-2'>
        <Label className='text-[var(--text-secondary)] text-sm'>Environment</Label>
        <div className='flex gap-1'>
          {ENV_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type='button'
              onClick={() => setEnvironment(opt.id)}
              className={cn(
                'rounded-md px-3 py-1 font-medium text-sm transition-colors',
                environment === opt.id
                  ? 'bg-[var(--surface-hover)] text-[var(--text-primary)]'
                  : 'text-[var(--text-tertiary)] hover-hover:hover:text-[var(--text-secondary)]'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab bar */}
      <div className='flex gap-1 border-[var(--border-secondary)] border-b pb-px'>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type='button'
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'relative px-3 py-2 font-medium text-sm transition-colors',
              activeTab === tab.id
                ? 'text-[var(--text-primary)]'
                : 'text-[var(--text-tertiary)] hover-hover:hover:text-[var(--text-secondary)]'
            )}
          >
            {tab.label}
            {activeTab === tab.id && (
              <span className='absolute right-0 bottom-0 left-0 h-[2px] bg-[var(--text-primary)]' />
            )}
          </button>
        ))}
      </div>

      {/* Time range (shared across tabs) */}
      <div className='flex items-center gap-3'>
        <div className='flex items-center gap-2'>
          <Label className='text-[var(--text-secondary)] text-caption'>From</Label>
          <EmcnInput
            type='datetime-local'
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className='h-[30px] text-caption'
          />
        </div>
        <div className='flex items-center gap-2'>
          <Label className='text-[var(--text-secondary)] text-caption'>To</Label>
          <EmcnInput
            type='datetime-local'
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className='h-[30px] text-caption'
          />
        </div>
      </div>

      <Divider />

      {activeTab === 'overview' && (
        <OverviewTab environment={environment} start={toRFC3339(start)} end={toRFC3339(end)} />
      )}
      {activeTab === 'licenses' && <LicensesTab environment={environment} />}
      {activeTab === 'enterprise' && (
        <EnterpriseTab environment={environment} start={toRFC3339(start)} end={toRFC3339(end)} />
      )}
      {activeTab === 'traces' && <TracesTab environment={environment} />}
    </div>
  )
}

/* ─── Overview Tab ─── */

function OverviewTab({
  environment,
  start,
  end,
}: {
  environment: MothershipEnv
  start: string
  end: string
}) {
  const { data: breakdown, isLoading: breakdownLoading } = useMothershipUserBreakdown(
    environment,
    start,
    end
  )
  const { data: requests, isLoading: requestsLoading } = useMothershipRequests(
    environment,
    start,
    end
  )

  return (
    <div className='flex flex-col gap-5'>
      {/* Summary cards */}
      <div className='grid grid-cols-4 gap-3'>
        <StatCard
          label='Total Requests'
          value={breakdown?.total_requests}
          loading={breakdownLoading}
        />
        <StatCard label='Unique Users' value={breakdown?.total_users} loading={breakdownLoading} />
        <StatCard
          label='Total Cost'
          value={
            breakdown?.users
              ? formatCost(
                  breakdown.users.reduce(
                    (s: number, u: { total_cost: number }) => s + u.total_cost,
                    0
                  )
                )
              : undefined
          }
          loading={breakdownLoading}
        />
        <StatCard
          label='Avg Cost/Request'
          value={
            breakdown?.total_requests && breakdown.users
              ? formatCost(
                  breakdown.users.reduce(
                    (s: number, u: { total_cost: number }) => s + u.total_cost,
                    0
                  ) / breakdown.total_requests
                )
              : undefined
          }
          loading={breakdownLoading}
        />
      </div>

      {/* User breakdown */}
      <SectionLabel>User Breakdown</SectionLabel>
      {breakdownLoading && (
        <div className='flex flex-col gap-2'>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className='h-[36px] w-full rounded-md' />
          ))}
        </div>
      )}
      {breakdown?.users && (
        <div className='flex flex-col gap-0.5'>
          <div className='flex items-center gap-3 border-[var(--border-secondary)] border-b px-3 py-2 text-[var(--text-tertiary)] text-caption'>
            <span className='flex-1'>User ID</span>
            <span className='w-[100px] text-right'>Requests</span>
            <span className='w-[100px] text-right'>Cost</span>
            <span className='w-[160px] text-right'>Last Request</span>
          </div>
          {breakdown.users.map(
            (u: {
              user_id: string
              request_count: number
              total_cost: number
              last_request: string
            }) => (
              <div
                key={u.user_id}
                className='flex items-center gap-3 border-[var(--border-secondary)] border-b px-3 py-2 text-small last:border-b-0'
              >
                <span className='flex-1 truncate font-mono text-[12px] text-[var(--text-primary)]'>
                  {u.user_id}
                </span>
                <span className='w-[100px] text-right text-[var(--text-secondary)]'>
                  {u.request_count}
                </span>
                <span className='w-[100px] text-right text-[var(--text-secondary)]'>
                  {formatCost(u.total_cost)}
                </span>
                <span className='w-[160px] text-right text-[var(--text-tertiary)] text-caption'>
                  {formatDate(u.last_request)}
                </span>
              </div>
            )
          )}
        </div>
      )}

      {/* Recent requests */}
      <Divider />
      <SectionLabel>Recent Requests ({requests?.count ?? '…'})</SectionLabel>
      {requestsLoading && (
        <div className='flex flex-col gap-2'>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className='h-[36px] w-full rounded-md' />
          ))}
        </div>
      )}
      {requests?.requests && (
        <div className='max-h-[400px] overflow-auto'>
          <div className='flex flex-col gap-0.5'>
            <div className='sticky top-0 z-10 flex items-center gap-3 border-[var(--border-secondary)] border-b bg-[var(--surface-1)] px-3 py-2 text-[var(--text-tertiary)] text-caption'>
              <span className='w-[180px]'>Request ID</span>
              <span className='w-[80px]'>Model</span>
              <span className='w-[80px] text-right'>Duration</span>
              <span className='w-[80px] text-right'>Cost</span>
              <span className='w-[60px] text-right'>Tools</span>
              <span className='w-[70px] text-right'>Status</span>
              <span className='flex-1 text-right'>Time</span>
            </div>
            {requests.requests
              .slice(0, 100)
              .map(
                (r: {
                  request_id: string
                  model: string
                  duration_ms: number
                  billed_total_cost: number
                  tool_call_count: number
                  error: boolean
                  aborted: boolean
                  created_at: string
                }) => (
                  <div
                    key={r.request_id}
                    className='flex items-center gap-3 border-[var(--border-secondary)] border-b px-3 py-1.5 text-small last:border-b-0'
                  >
                    <span className='w-[180px] truncate font-mono text-[11px] text-[var(--text-primary)]'>
                      {r.request_id ?? '—'}
                    </span>
                    <span className='w-[80px] truncate text-[var(--text-secondary)] text-caption'>
                      {(r.model ?? '').replace('claude-', '')}
                    </span>
                    <span className='w-[80px] text-right text-[var(--text-secondary)] text-caption'>
                      {r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : '—'}
                    </span>
                    <span className='w-[80px] text-right text-[var(--text-secondary)] text-caption'>
                      {formatCost(r.billed_total_cost ?? 0)}
                    </span>
                    <span className='w-[60px] text-right text-[var(--text-secondary)] text-caption'>
                      {r.tool_call_count ?? 0}
                    </span>
                    <span className='w-[70px] text-right'>
                      {r.error ? (
                        <Badge variant='red'>Error</Badge>
                      ) : r.aborted ? (
                        <Badge variant='amber'>Abort</Badge>
                      ) : (
                        <Badge variant='green'>OK</Badge>
                      )}
                    </span>
                    <span className='flex-1 text-right text-[var(--text-tertiary)] text-caption'>
                      {formatDate(r.created_at)}
                    </span>
                  </div>
                )
              )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Licenses Tab ─── */

function LicensesTab({ environment }: { environment: MothershipEnv }) {
  const { data, isLoading, refetch } = useMothershipLicenses(environment)
  const generateLicense = useGenerateLicense(environment)
  const [newName, setNewName] = useState('')
  const [newExpiry, setNewExpiry] = useState('')
  const [generatedKey, setGeneratedKey] = useState<string | null>(null)

  const handleGenerate = useCallback(() => {
    if (!newName.trim()) return
    generateLicense.mutate(
      {
        name: newName.trim(),
        ...(newExpiry ? { expirationDate: newExpiry } : {}),
      },
      {
        onSuccess: (result) => {
          setGeneratedKey(result.license_key)
          setNewName('')
          setNewExpiry('')
          refetch()
        },
      }
    )
  }, [newName, newExpiry, generateLicense, refetch])

  return (
    <div className='flex flex-col gap-5'>
      <SectionLabel>Generate License</SectionLabel>
      <div className='flex items-end gap-2'>
        <div className='flex flex-col gap-1'>
          <Label className='text-[var(--text-secondary)] text-caption'>Enterprise Name</Label>
          <EmcnInput
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value)
              setGeneratedKey(null)
            }}
            placeholder='e.g. Acme Corp'
            className='h-[32px] w-[200px]'
          />
        </div>
        <div className='flex flex-col gap-1'>
          <Label className='text-[var(--text-secondary)] text-caption'>Expiration (optional)</Label>
          <EmcnInput
            type='date'
            value={newExpiry}
            onChange={(e) => setNewExpiry(e.target.value)}
            className='h-[32px] w-[160px]'
          />
        </div>
        <Button
          variant='primary'
          className='h-[32px]'
          onClick={handleGenerate}
          disabled={generateLicense.isPending || !newName.trim()}
        >
          {generateLicense.isPending ? 'Generating...' : 'Generate'}
        </Button>
      </div>

      {generatedKey && (
        <div className='rounded-md border border-[var(--border-secondary)] bg-[var(--surface-hover)] p-3'>
          <p className='mb-1 text-[var(--text-secondary)] text-caption'>
            License key (only shown once):
          </p>
          <code className='block break-all font-mono text-[12px] text-[var(--text-primary)]'>
            {generatedKey}
          </code>
        </div>
      )}

      {generateLicense.error && (
        <p className='text-[var(--text-error)] text-small'>{generateLicense.error.message}</p>
      )}

      <Divider />
      <SectionLabel>All Licenses</SectionLabel>

      {isLoading && (
        <div className='flex flex-col gap-2'>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className='h-[40px] w-full rounded-md' />
          ))}
        </div>
      )}

      {data?.licenses && (
        <div className='flex flex-col gap-0.5'>
          <div className='flex items-center gap-3 border-[var(--border-secondary)] border-b px-3 py-2 text-[var(--text-tertiary)] text-caption'>
            <span className='flex-1'>Name</span>
            <span className='w-[100px] text-right'>Validations</span>
            <span className='w-[140px] text-right'>Expiration</span>
            <span className='w-[140px] text-right'>Created</span>
          </div>
          {data.licenses.length === 0 && (
            <div className='py-4 text-center text-[var(--text-tertiary)] text-small'>
              No licenses found.
            </div>
          )}
          {data.licenses.map(
            (lic: {
              id: string
              name: string
              count: number
              expiration_date?: string
              created_at: string
            }) => (
              <div
                key={lic.id}
                className='flex items-center gap-3 border-[var(--border-secondary)] border-b px-3 py-2 text-small last:border-b-0'
              >
                <span className='flex-1 text-[var(--text-primary)]'>{lic.name}</span>
                <span className='w-[100px] text-right text-[var(--text-secondary)]'>
                  {lic.count}
                </span>
                <span className='w-[140px] text-right text-[var(--text-tertiary)] text-caption'>
                  {lic.expiration_date ? formatDate(lic.expiration_date) : 'Never'}
                </span>
                <span className='w-[140px] text-right text-[var(--text-tertiary)] text-caption'>
                  {formatDate(lic.created_at)}
                </span>
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}

/* ─── Enterprise Tab ─── */

function EnterpriseTab({
  environment,
  start,
  end,
}: {
  environment: MothershipEnv
  start: string
  end: string
}) {
  const [customerType, setCustomerType] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const { data, isLoading, error } = useMothershipEnterpriseStats(
    environment,
    customerType,
    start,
    end
  )

  const handleSearch = () => {
    setCustomerType(searchInput.trim())
  }

  return (
    <div className='flex flex-col gap-5'>
      <div className='flex items-center gap-2'>
        <EmcnInput
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder='Enter customer type (e.g. enterprise name)...'
        />
        <Button variant='primary' onClick={handleSearch} disabled={!searchInput.trim()}>
          Search
        </Button>
      </div>

      {error && <p className='text-[var(--text-error)] text-small'>{error.message}</p>}

      {isLoading && customerType && (
        <div className='flex flex-col gap-2'>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className='h-[60px] w-full rounded-md' />
          ))}
        </div>
      )}

      {data && (
        <>
          <div className='grid grid-cols-4 gap-3'>
            <StatCard label='Total Requests' value={data.total_requests} />
            <StatCard label='Unique Users' value={data.unique_users} />
            <StatCard label='Total Cost' value={formatCost(data.total_cost ?? 0)} />
            <StatCard
              label='Total Tokens'
              value={(
                (data.total_input_tokens ?? 0) + (data.total_output_tokens ?? 0)
              ).toLocaleString()}
            />
          </div>

          {data.top_models && (
            <>
              <Divider />
              <SectionLabel>Top Models</SectionLabel>
              <div className='flex flex-wrap gap-2'>
                {data.top_models.map((m: { model: string; count: number }) => (
                  <Badge key={m.model} variant='gray'>
                    {m.model} ({m.count})
                  </Badge>
                ))}
              </div>
            </>
          )}

          {data.users && (
            <>
              <Divider />
              <SectionLabel>User Breakdown</SectionLabel>
              <div className='flex flex-col gap-0.5'>
                <div className='flex items-center gap-3 border-[var(--border-secondary)] border-b px-3 py-2 text-[var(--text-tertiary)] text-caption'>
                  <span className='flex-1'>User ID</span>
                  <span className='w-[100px] text-right'>Requests</span>
                  <span className='w-[100px] text-right'>Cost</span>
                  <span className='w-[160px] text-right'>Last Request</span>
                </div>
                {data.users.map(
                  (u: {
                    user_id: string
                    request_count: number
                    total_cost: number
                    last_request: string
                  }) => (
                    <div
                      key={u.user_id}
                      className='flex items-center gap-3 border-[var(--border-secondary)] border-b px-3 py-2 text-small last:border-b-0'
                    >
                      <span className='flex-1 truncate font-mono text-[12px] text-[var(--text-primary)]'>
                        {u.user_id}
                      </span>
                      <span className='w-[100px] text-right text-[var(--text-secondary)]'>
                        {u.request_count}
                      </span>
                      <span className='w-[100px] text-right text-[var(--text-secondary)]'>
                        {formatCost(u.total_cost)}
                      </span>
                      <span className='w-[160px] text-right text-[var(--text-tertiary)] text-caption'>
                        {formatDate(u.last_request)}
                      </span>
                    </div>
                  )
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

/* ─── Traces Tab ─── */

function TracesTab({ environment }: { environment: MothershipEnv }) {
  const [requestIdInput, setRequestIdInput] = useState('')
  const [activeRequestId, setActiveRequestId] = useState('')
  const { data: trace, isLoading, error } = useMothershipTrace(environment, activeRequestId)

  const handleLookup = () => {
    setActiveRequestId(requestIdInput.trim())
  }

  return (
    <div className='flex flex-col gap-5'>
      <div className='flex items-center gap-2'>
        <EmcnInput
          value={requestIdInput}
          onChange={(e) => setRequestIdInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
          placeholder='Paste a request ID (sim_request_id)...'
          className='font-mono text-[13px]'
        />
        <Button variant='primary' onClick={handleLookup} disabled={!requestIdInput.trim()}>
          Lookup
        </Button>
      </div>

      {error && <p className='text-[var(--text-error)] text-small'>{error.message}</p>}

      {isLoading && activeRequestId && (
        <div className='flex flex-col gap-2'>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className='h-[50px] w-full rounded-md' />
          ))}
        </div>
      )}

      {trace && <TraceDetail trace={trace} />}
    </div>
  )
}

/* ─── Trace Detail ─── */

interface TraceSpan {
  name: string
  kind?: string
  startMs: number
  endMs?: number
  durationMs?: number
  status: string
  parentName?: string
  source?: string
  attributes?: Record<string, unknown>
}

interface TraceData {
  id: string
  simRequestId: string
  goTraceId: string
  streamId?: string
  chatId?: string
  userId?: string
  startMs: number
  endMs: number
  durationMs: number
  outcome: string
  spans: TraceSpan[]
  model?: string
  provider?: string
  mode?: string
  source?: string
  message?: string
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  rawTotalCost?: number
  billedTotalCost?: number
  toolCallCount?: number
  error?: boolean
  aborted?: boolean
  errorMsg?: string
}

function TraceDetail({ trace }: { trace: TraceData }) {
  const rootSpans = trace.spans.filter((s) => !s.parentName)
  const childMap = new Map<string, TraceSpan[]>()
  for (const span of trace.spans) {
    if (span.parentName) {
      const existing = childMap.get(span.parentName) || []
      existing.push(span)
      childMap.set(span.parentName, existing)
    }
  }

  return (
    <div className='flex flex-col gap-4'>
      {/* Trace metadata */}
      <div className='grid grid-cols-2 gap-x-6 gap-y-2 rounded-md border border-[var(--border-secondary)] p-4'>
        <MetaRow label='Go Trace ID' value={trace.goTraceId} mono />
        <MetaRow label='Sim Request ID' value={trace.simRequestId} mono />
        <MetaRow label='Outcome'>
          <Badge
            variant={
              trace.outcome === 'success'
                ? 'green'
                : trace.outcome === 'cancelled'
                  ? 'amber'
                  : 'red'
            }
          >
            {trace.outcome}
          </Badge>
        </MetaRow>
        <MetaRow label='Duration' value={`${(trace.durationMs / 1000).toFixed(2)}s`} />
        <MetaRow label='Model' value={trace.model || '—'} />
        <MetaRow label='Provider' value={trace.provider || '—'} />
        <MetaRow label='Source' value={trace.source || '—'} />
        <MetaRow label='Mode' value={trace.mode || '—'} />
        {trace.userId && <MetaRow label='User ID' value={trace.userId} mono />}
        {trace.chatId && <MetaRow label='Chat ID' value={trace.chatId} mono />}
        <MetaRow
          label='Tokens'
          value={`${(trace.inputTokens ?? 0).toLocaleString()} in / ${(trace.outputTokens ?? 0).toLocaleString()} out`}
        />
        <MetaRow label='Billed Cost' value={formatCost(trace.billedTotalCost ?? 0)} />
        {trace.toolCallCount != null && trace.toolCallCount > 0 && (
          <MetaRow label='Tool Calls' value={String(trace.toolCallCount)} />
        )}
        {trace.message && (
          <div className='col-span-2'>
            <MetaRow label='Message' value={trace.message} />
          </div>
        )}
        {trace.errorMsg && (
          <div className='col-span-2'>
            <MetaRow label='Error'>
              <span className='text-[var(--text-error)]'>{trace.errorMsg}</span>
            </MetaRow>
          </div>
        )}
      </div>

      {/* Span tree */}
      <SectionLabel>Spans ({trace.spans.length})</SectionLabel>
      <div className='flex flex-col gap-1'>
        {rootSpans
          .sort((a, b) => a.startMs - b.startMs)
          .map((span) => (
            <SpanNode
              key={span.name + span.startMs}
              span={span}
              childMap={childMap}
              traceStartMs={trace.startMs}
              traceDurationMs={trace.durationMs}
              depth={0}
            />
          ))}
      </div>
    </div>
  )
}

function SpanNode({
  span,
  childMap,
  traceStartMs,
  traceDurationMs,
  depth,
}: {
  span: TraceSpan
  childMap: Map<string, TraceSpan[]>
  traceStartMs: number
  traceDurationMs: number
  depth: number
}) {
  const [expanded, setExpanded] = useState(depth < 2)
  const children = childMap.get(span.name) || []
  const hasChildren = children.length > 0
  const durationMs = span.durationMs ?? (span.endMs ? span.endMs - span.startMs : 0)
  const offsetPct =
    traceDurationMs > 0 ? ((span.startMs - traceStartMs) / traceDurationMs) * 100 : 0
  const widthPct = traceDurationMs > 0 ? (durationMs / traceDurationMs) * 100 : 0

  const statusColor =
    span.status === 'ok'
      ? 'bg-emerald-500/70'
      : span.status === 'error'
        ? 'bg-red-500/70'
        : span.status === 'cancelled'
          ? 'bg-yellow-500/70'
          : 'bg-[var(--text-tertiary)]'

  const attrs = span.attributes || {}
  const attrEntries = Object.entries(attrs).filter(
    ([, v]) => v !== null && v !== undefined && v !== ''
  )

  return (
    <div style={{ marginLeft: depth * 16 }}>
      <button
        type='button'
        onClick={() => setExpanded((e) => !e)}
        className='flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover-hover:hover:bg-[var(--surface-hover)]'
      >
        {hasChildren ? (
          <span className='w-[14px] text-center text-[10px] text-[var(--text-tertiary)]'>
            {expanded ? '▼' : '▶'}
          </span>
        ) : (
          <span className='w-[14px]' />
        )}

        <span className='min-w-0 flex-1'>
          <span className='block truncate text-[13px] text-[var(--text-primary)]'>{span.name}</span>
          {/* Waterfall bar */}
          <span className='mt-0.5 block h-[4px] w-full rounded-full bg-[var(--border-secondary)]'>
            <span
              className={cn('block h-full rounded-full', statusColor)}
              style={{
                marginLeft: `${Math.max(0, Math.min(offsetPct, 100))}%`,
                width: `${Math.max(0.5, Math.min(widthPct, 100 - offsetPct))}%`,
              }}
            />
          </span>
        </span>

        <Badge variant={span.source === 'go' ? 'blue' : 'gray'} className='shrink-0'>
          {span.source || '?'}
        </Badge>

        <span className='w-[70px] shrink-0 text-right font-mono text-[11px] text-[var(--text-secondary)]'>
          {durationMs >= 1000 ? `${(durationMs / 1000).toFixed(2)}s` : `${durationMs}ms`}
        </span>
      </button>

      {expanded && attrEntries.length > 0 && (
        <div
          className='mb-1 ml-[30px] rounded border border-[var(--border-secondary)] bg-[var(--surface-hover)] px-3 py-2'
          style={{ marginLeft: 30 + depth * 16 }}
        >
          {attrEntries.map(([key, val]) => (
            <div key={key} className='flex gap-2 py-0.5 text-[11px]'>
              <span className='shrink-0 text-[var(--text-tertiary)]'>{key}:</span>
              <span className='min-w-0 break-all text-[var(--text-secondary)]'>
                {typeof val === 'object' ? JSON.stringify(val) : String(val)}
              </span>
            </div>
          ))}
        </div>
      )}

      {expanded &&
        children
          .sort((a, b) => a.startMs - b.startMs)
          .map((child) => (
            <SpanNode
              key={child.name + child.startMs}
              span={child}
              childMap={childMap}
              traceStartMs={traceStartMs}
              traceDurationMs={traceDurationMs}
              depth={depth + 1}
            />
          ))}
    </div>
  )
}

/* ─── Shared components ─── */

function StatCard({
  label,
  value,
  loading,
}: {
  label: string
  value?: string | number
  loading?: boolean
}) {
  return (
    <div className='rounded-md border border-[var(--border-secondary)] p-3'>
      <p className='text-[var(--text-tertiary)] text-caption'>{label}</p>
      {loading ? (
        <Skeleton className='mt-1 h-[24px] w-[80px] rounded-sm' />
      ) : (
        <p className='mt-1 font-medium text-[18px] text-[var(--text-primary)]'>{value ?? '—'}</p>
      )}
    </div>
  )
}

function MetaRow({
  label,
  value,
  mono,
  children,
}: {
  label: string
  value?: string
  mono?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className='flex items-baseline gap-2'>
      <span className='shrink-0 text-[var(--text-tertiary)] text-caption'>{label}</span>
      {children || (
        <span
          className={cn(
            'min-w-0 break-all text-[13px] text-[var(--text-primary)]',
            mono && 'font-mono text-[12px]'
          )}
        >
          {value}
        </span>
      )}
    </div>
  )
}
