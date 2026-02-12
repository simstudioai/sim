import crypto from 'crypto'

type StoreEntry<T> = {
  value: T
  expiresAt: number
}

const DEFAULT_TTL_MS = 30 * 60 * 1000
const MAX_ENTRIES = 500

class TTLStore<T> {
  private readonly data = new Map<string, StoreEntry<T>>()

  constructor(private readonly ttlMs = DEFAULT_TTL_MS) {}

  set(value: T): string {
    this.gc()
    if (this.data.size >= MAX_ENTRIES) {
      const firstKey = this.data.keys().next().value as string | undefined
      if (firstKey) {
        this.data.delete(firstKey)
      }
    }
    const id = crypto.randomUUID()
    this.data.set(id, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    })
    return id
  }

  get(id: string): T | null {
    const entry = this.data.get(id)
    if (!entry) return null
    if (entry.expiresAt <= Date.now()) {
      this.data.delete(id)
      return null
    }
    return entry.value
  }

  private gc(): void {
    const now = Date.now()
    for (const [key, entry] of this.data.entries()) {
      if (entry.expiresAt <= now) {
        this.data.delete(key)
      }
    }
  }
}

export type WorkflowContextPack = {
  workflowId: string
  snapshotHash: string
  workflowState: {
    blocks: Record<string, any>
    edges: Array<Record<string, any>>
    loops: Record<string, any>
    parallels: Record<string, any>
  }
  schemasByType: Record<string, any>
  schemaRefsByType: Record<string, string>
  summary: Record<string, any>
}

export type WorkflowChangeProposal = {
  workflowId: string
  baseSnapshotHash: string
  compiledOperations: Array<Record<string, any>>
  diffSummary: Record<string, any>
  warnings: string[]
  diagnostics: string[]
  touchedBlocks: string[]
}

const contextPackStore = new TTLStore<WorkflowContextPack>()
const proposalStore = new TTLStore<WorkflowChangeProposal>()

export function saveContextPack(pack: WorkflowContextPack): string {
  return contextPackStore.set(pack)
}

export function getContextPack(id: string): WorkflowContextPack | null {
  return contextPackStore.get(id)
}

export function saveProposal(proposal: WorkflowChangeProposal): string {
  return proposalStore.set(proposal)
}

export function getProposal(id: string): WorkflowChangeProposal | null {
  return proposalStore.get(id)
}
