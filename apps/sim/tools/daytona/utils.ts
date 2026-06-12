import type { DaytonaSandboxSummary } from '@/tools/daytona/types'

export const DAYTONA_API_BASE_URL = 'https://app.daytona.io/api'

export const DAYTONA_TOOLBOX_BASE_URL = 'https://proxy.app.daytona.io/toolbox'

/**
 * Builds a toolbox API URL for a sandbox-scoped endpoint.
 */
export function daytonaToolboxUrl(sandboxId: string, path: string): string {
  return `${DAYTONA_TOOLBOX_BASE_URL}/${encodeURIComponent(sandboxId.trim())}${path}`
}

/**
 * Extracts a human-readable error message from a Daytona API error response.
 */
export async function extractDaytonaError(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json()
    if (typeof data?.message === 'string') return data.message
    if (Array.isArray(data?.message)) return data.message.join(', ')
    if (typeof data?.error === 'string') return data.error
  } catch {
    // Non-JSON error body; fall through to the fallback message
  }
  return `${fallback} (status ${response.status})`
}

/**
 * Coerces an optional user- or LLM-provided value to a number, treating
 * empty/missing values as undefined.
 */
export function toOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const num = Number(value)
  return Number.isNaN(num) ? undefined : num
}

/**
 * Coerces an optional user- or LLM-provided value to a boolean, treating
 * empty/missing values as undefined.
 */
export function toOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'boolean') return value
  return value === 'true'
}

/**
 * Maps a raw Daytona sandbox object to the normalized summary shape.
 */
export function mapDaytonaSandbox(sandbox: Record<string, any>): DaytonaSandboxSummary {
  return {
    id: sandbox.id ?? '',
    name: sandbox.name ?? '',
    state: sandbox.state ?? null,
    snapshot: sandbox.snapshot ?? null,
    target: sandbox.target ?? null,
    cpu: sandbox.cpu ?? null,
    gpu: sandbox.gpu ?? null,
    memory: sandbox.memory ?? null,
    disk: sandbox.disk ?? null,
    labels: sandbox.labels ?? {},
    public: sandbox.public ?? null,
    errorReason: sandbox.errorReason ?? null,
    autoStopInterval: sandbox.autoStopInterval ?? null,
    createdAt: sandbox.createdAt ?? null,
    updatedAt: sandbox.updatedAt ?? null,
  }
}

/**
 * Shared output property map for sandbox summary outputs.
 */
export const DAYTONA_SANDBOX_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Sandbox ID' },
  name: { type: 'string', description: 'Sandbox name' },
  state: { type: 'string', description: 'Sandbox state (e.g., started, stopped)', optional: true },
  snapshot: {
    type: 'string',
    description: 'Snapshot the sandbox was created from',
    optional: true,
  },
  target: { type: 'string', description: 'Region the sandbox runs in', optional: true },
  cpu: { type: 'number', description: 'CPU cores allocated', optional: true },
  gpu: { type: 'number', description: 'GPU units allocated', optional: true },
  memory: { type: 'number', description: 'Memory allocated in GB', optional: true },
  disk: { type: 'number', description: 'Disk space allocated in GB', optional: true },
  labels: { type: 'json', description: 'Labels attached to the sandbox', optional: true },
  public: { type: 'boolean', description: 'Whether the HTTP preview is public', optional: true },
  errorReason: { type: 'string', description: 'Error reason if in error state', optional: true },
  autoStopInterval: {
    type: 'number',
    description: 'Auto-stop interval in minutes (0 means disabled)',
    optional: true,
  },
  createdAt: { type: 'string', description: 'Creation timestamp', optional: true },
  updatedAt: { type: 'string', description: 'Last update timestamp', optional: true },
} as const
