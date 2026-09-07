import {
  type WorkspaceSearchFilters,
  workspaceSearchFiltersSchema,
} from '@/lib/api/contracts/knowledge/search'
/**
 * Safe localStorage utilities with SSR support
 * Provides clean error handling and type safety for browser storage operations
 */

import { createLogger } from '@sim/logger'
import type {
  ChatRequestMode,
  FileAttachmentForApi,
} from '@/app/workspace/[workspaceId]/home/types'
import type { ChatContext } from '@/stores/panel'

const logger = createLogger('BrowserStorage')

/**
 * Safe localStorage operations with fallbacks
 */
export class BrowserStorage {
  /**
   * Safely gets an item from localStorage
   * @param key - The storage key
   * @param defaultValue - The default value to return if key doesn't exist or access fails
   * @returns The stored value or default value
   */
  static getItem<T = string>(key: string, defaultValue: T): T {
    if (typeof window === 'undefined') {
      return defaultValue
    }

    try {
      const item = window.localStorage.getItem(key)
      if (item === null) {
        return defaultValue
      }

      try {
        return JSON.parse(item) as T
      } catch {
        return item as T
      }
    } catch (error) {
      logger.warn(`Failed to get localStorage item "${key}":`, error)
      return defaultValue
    }
  }

  /**
   * Safely sets an item in localStorage
   * @param key - The storage key
   * @param value - The value to store
   * @returns True if successful, false otherwise
   */
  static setItem<T>(key: string, value: T): boolean {
    if (typeof window === 'undefined') {
      return false
    }

    try {
      const serializedValue = typeof value === 'string' ? value : JSON.stringify(value)
      window.localStorage.setItem(key, serializedValue)
      return true
    } catch (error) {
      logger.warn(`Failed to set localStorage item "${key}":`, error)
      return false
    }
  }

  /**
   * Safely removes an item from localStorage
   * @param key - The storage key to remove
   * @returns True if successful, false otherwise
   */
  static removeItem(key: string): boolean {
    if (typeof window === 'undefined') {
      return false
    }

    try {
      window.localStorage.removeItem(key)
      return true
    } catch (error) {
      logger.warn(`Failed to remove localStorage item "${key}":`, error)
      return false
    }
  }

  /**
   * Check if localStorage is available
   * @returns True if localStorage is available and accessible
   */
  static isAvailable(): boolean {
    if (typeof window === 'undefined') {
      return false
    }

    try {
      const testKey = '__test_localStorage_availability__'
      window.localStorage.setItem(testKey, 'test')
      window.localStorage.removeItem(testKey)
      return true
    } catch {
      return false
    }
  }
}

export const STORAGE_KEYS = {
  LANDING_PAGE_PROMPT: 'sim_landing_page_prompt',
  LANDING_PAGE_WORKFLOW_SEED: 'sim_landing_page_workflow_seed',
  WORKSPACE_RECENCY: 'sim_workspace_recency',
  MOTHERSHIP_HANDOFF: 'sim_mothership_handoff',
} as const

export class WorkspaceRecencyStorage {
  private static readonly KEY = STORAGE_KEYS.WORKSPACE_RECENCY

  static touch(workspaceId: string): void {
    const map = WorkspaceRecencyStorage.getAll()
    map[workspaceId] = Date.now()
    BrowserStorage.setItem(WorkspaceRecencyStorage.KEY, map)
  }

  static getAll(): Record<string, number> {
    return BrowserStorage.getItem<Record<string, number>>(WorkspaceRecencyStorage.KEY, {})
  }

  static getMostRecent(): string | null {
    const map = WorkspaceRecencyStorage.getAll()
    const entries = Object.entries(map)
    if (entries.length === 0) return null
    entries.sort((a, b) => b[1] - a[1])
    return entries[0][0]
  }

  static remove(workspaceId: string): void {
    const map = WorkspaceRecencyStorage.getAll()
    delete map[workspaceId]
    BrowserStorage.setItem(WorkspaceRecencyStorage.KEY, map)
  }

  /**
   * Removes localStorage entries for workspace IDs not in the provided list.
   * Call from effects or event handlers, not during render.
   */
  static prune(validIds: Set<string>): void {
    const map = WorkspaceRecencyStorage.getAll()
    let pruned = false
    for (const id of Object.keys(map)) {
      if (!validIds.has(id)) {
        delete map[id]
        pruned = true
      }
    }
    if (pruned) {
      BrowserStorage.setItem(WorkspaceRecencyStorage.KEY, map)
    }
  }

  /**
   * Sorts workspaces by recency (most recent first).
   * Workspaces without a recorded timestamp are placed after tracked ones.
   * Pure function safe for use in render-phase computations.
   */
  static sortByRecency<T extends { id: string }>(workspaces: T[]): T[] {
    const map = WorkspaceRecencyStorage.getAll()
    return [...workspaces].sort((a, b) => {
      const aTime = map[a.id] ?? 0
      const bTime = map[b.id] ?? 0
      return bTime - aTime
    })
  }
}

/**
 * Specialized utility for managing the landing page prompt
 */
export class LandingPromptStorage {
  private static readonly KEY = STORAGE_KEYS.LANDING_PAGE_PROMPT

  /**
   * Store a prompt from the landing page
   * @param prompt - The prompt text to store
   * @returns True if successful, false otherwise
   */
  static store(prompt: string): boolean {
    if (!prompt || prompt.trim().length === 0) {
      return false
    }

    const data = {
      prompt: prompt.trim(),
      timestamp: Date.now(),
    }

    return BrowserStorage.setItem(LandingPromptStorage.KEY, data)
  }

  /**
   * Retrieve and consume the stored prompt
   * @param maxAge - Maximum age of the prompt in milliseconds (default: 24 hours)
   * @returns The stored prompt or null if not found/expired
   */
  static consume(maxAge: number = 24 * 60 * 60 * 1000): string | null {
    const data = BrowserStorage.getItem<{ prompt: string; timestamp: number } | null>(
      LandingPromptStorage.KEY,
      null
    )

    if (!data || !data.prompt || !data.timestamp) {
      return null
    }

    const age = Date.now() - data.timestamp
    if (age > maxAge) {
      LandingPromptStorage.clear()
      return null
    }

    LandingPromptStorage.clear()
    return data.prompt
  }

  /**
   * Check if there's a stored prompt without consuming it
   * @param maxAge - Maximum age of the prompt in milliseconds (default: 24 hours)
   * @returns True if there's a valid prompt, false otherwise
   */
  static hasPrompt(maxAge: number = 24 * 60 * 60 * 1000): boolean {
    const data = BrowserStorage.getItem<{ prompt: string; timestamp: number } | null>(
      LandingPromptStorage.KEY,
      null
    )

    if (!data || !data.prompt || !data.timestamp) {
      return false
    }

    const age = Date.now() - data.timestamp
    if (age > maxAge) {
      LandingPromptStorage.clear()
      return false
    }

    return true
  }

  /**
   * Clear the stored prompt
   * @returns True if successful, false otherwise
   */
  static clear(): boolean {
    return BrowserStorage.removeItem(LandingPromptStorage.KEY)
  }
}

export interface LandingWorkflowSeed {
  templateId: string
  workflowName: string
  workflowDescription?: string
  workflowJson: string
}

/**
 * Specialized utility for managing a landing-page workflow seed.
 * Stores a workflow export JSON so it can be imported after signup.
 */
export class LandingWorkflowSeedStorage {
  private static readonly KEY = STORAGE_KEYS.LANDING_PAGE_WORKFLOW_SEED

  static store(seed: LandingWorkflowSeed): boolean {
    if (!seed.templateId || !seed.workflowName || !seed.workflowJson) {
      return false
    }

    return BrowserStorage.setItem(LandingWorkflowSeedStorage.KEY, {
      ...seed,
      timestamp: Date.now(),
    })
  }

  static consume(maxAge: number = 24 * 60 * 60 * 1000): LandingWorkflowSeed | null {
    const data = BrowserStorage.getItem<(LandingWorkflowSeed & { timestamp: number }) | null>(
      LandingWorkflowSeedStorage.KEY,
      null
    )

    if (!data || !data.templateId || !data.workflowName || !data.timestamp || !data.workflowJson) {
      return null
    }

    if (Date.now() - data.timestamp > maxAge) {
      LandingWorkflowSeedStorage.clear()
      return null
    }

    LandingWorkflowSeedStorage.clear()
    const { timestamp: _timestamp, ...seed } = data
    return seed
  }

  static clear(): boolean {
    return BrowserStorage.removeItem(LandingWorkflowSeedStorage.KEY)
  }
}

export interface MothershipHandoff {
  /**
   * Message to auto-send once the home surface mounts. Omit for a chip-only
   * handoff, which seeds `contexts` into the input and waits for the user.
   */
  message?: string
  /** Structured contexts to attach — e.g. a `logs` mention tagging a run. */
  contexts?: ChatContext[]
  /** Already-uploaded attachment references riding along with the message. */
  fileAttachments?: FileAttachmentForApi[]
  /**
   * Set only when this handoff is the recovery of a send an unmount cleanup
   * withdrew: that attempt's message id. The consuming chat reuses it so the
   * server deduplicates against the first attempt instead of opening a second
   * chat and billing a second turn.
   */
  resumeUserMessageId?: string
  /** The request mode the withdrawn send asked for, so a retry stays the same kind of turn. */
  requestMode?: ChatRequestMode
  assistantSearch?: WorkspaceSearchFilters
}

type MothershipHandoffOwner = string | { organizationId: string }

interface StoredHandoff extends MothershipHandoff {
  workspaceId?: string
  organizationId?: string
  timestamp?: number
}

/**
 * One-shot handoff that seeds Chat (mothership) when the user is routed to the
 * workspace home from elsewhere in the app. Two shapes share this slot:
 *
 * - **With a message** — auto-sent on mount, e.g. the "Troubleshoot in Chat"
 *   action on an errored log, which tags the failed run and asks Sim to fix it.
 * - **Chips only** — the highlight-to-chat action on the standalone Files and
 *   Tables pages, which attaches reference chips and sends nothing.
 *
 * The home surface consumes this exactly once on mount. A short max-age guards
 * against a stale handoff firing on a later, unrelated visit, and `consume`
 * always clears the entry so it can never be replayed.
 */
export class MothershipHandoffStorage {
  private static readonly KEY = STORAGE_KEYS.MOTHERSHIP_HANDOFF

  /** How long a stored handoff stays eligible to fire, in milliseconds. */
  static readonly MAX_AGE_MS = 60 * 1000

  /**
   * Store a handoff for the next home-surface mount, scoped to the workspace it
   * targets so a different workspace never claims it. Chip-only handoffs
   * accumulate — "Add to chat" can fire twice before the route swap completes,
   * and the second write must not drop the first.
   * @returns True if stored, false when the workspace is empty or the handoff
   * carries neither a message nor a context.
   */
  static store(handoff: MothershipHandoff, owner: MothershipHandoffOwner): boolean {
    const workspaceId = typeof owner === 'string' ? owner : undefined
    const organizationId = typeof owner === 'string' ? undefined : owner.organizationId
    const message = handoff.message?.trim()
    const contexts = handoff.contexts ?? []
    if (!(workspaceId || organizationId) || (!message && contexts.length === 0)) {
      return false
    }

    return BrowserStorage.setItem(MothershipHandoffStorage.KEY, {
      ...(message ? { message } : {}),
      contexts: message
        ? contexts
        : [...MothershipHandoffStorage.pendingContexts(owner), ...contexts],
      ...(handoff.fileAttachments?.length ? { fileAttachments: handoff.fileAttachments } : {}),
      ...(handoff.resumeUserMessageId ? { resumeUserMessageId: handoff.resumeUserMessageId } : {}),
      ...(handoff.requestMode ? { requestMode: handoff.requestMode } : {}),
      ...(handoff.assistantSearch ? { assistantSearch: handoff.assistantSearch } : {}),
      workspaceId,
      organizationId,
      timestamp: Date.now(),
    })
  }

  /**
   * Contexts of an un-consumed chip-only handoff for `workspaceId`, else empty.
   *
   * Applies the same freshness bar as {@link consume}: accumulating carries the
   * old contexts onto a write that stamps a new `timestamp`, so without this an
   * abandoned handoff that had already aged out would ride along on the next
   * "Add to chat" and reappear as if it were current.
   */
  private static pendingContexts(owner: MothershipHandoffOwner): ChatContext[] {
    const data = BrowserStorage.getItem<StoredHandoff | null>(MothershipHandoffStorage.KEY, null)
    if (!data || data.message || !MothershipHandoffStorage.belongsTo(data, owner)) return []
    if (!data.timestamp || Date.now() - data.timestamp > MothershipHandoffStorage.MAX_AGE_MS) {
      return []
    }
    return Array.isArray(data.contexts) ? data.contexts : []
  }

  /**
   * Retrieve and consume the stored handoff for `workspaceId`. A handoff owned
   * by a different workspace is left untouched for its owner — its tagged run
   * only resolves in its own workspace, so misfiring it elsewhere would drop the
   * context. The owner (and any legacy/corrupt entry) is tombstoned via `clear`
   * before the validity/expiry checks so it fires at most once and never lingers.
   * @param maxAge - Maximum age in milliseconds (default: {@link MAX_AGE_MS})
   */
  static consume(
    owner: MothershipHandoffOwner,
    maxAge: number = MothershipHandoffStorage.MAX_AGE_MS
  ): MothershipHandoff | null {
    const data = BrowserStorage.getItem<StoredHandoff | null>(MothershipHandoffStorage.KEY, null)

    if (!data) {
      return null
    }

    if (
      (data.workspaceId || data.organizationId) &&
      !MothershipHandoffStorage.belongsTo(data, owner)
    ) {
      return null
    }

    MothershipHandoffStorage.clear()

    const contexts = Array.isArray(data.contexts) ? data.contexts : []
    if (
      !(data.workspaceId || data.organizationId) ||
      Boolean(data.workspaceId && data.organizationId) ||
      (!data.message && contexts.length === 0) ||
      !data.timestamp ||
      Date.now() - data.timestamp > maxAge
    ) {
      return null
    }

    const assistantSearch = workspaceSearchFiltersSchema.safeParse(data.assistantSearch ?? {})
    if (!assistantSearch.success) return null

    return {
      ...(data.message ? { message: data.message } : {}),
      contexts,
      ...(data.requestMode === 'assistant' ? { requestMode: 'assistant' as const } : {}),
      ...(data.assistantSearch ? { assistantSearch: assistantSearch.data } : {}),
      ...(Array.isArray(data.fileAttachments) && data.fileAttachments.length > 0
        ? { fileAttachments: data.fileAttachments }
        : {}),
      ...(typeof data.resumeUserMessageId === 'string' && data.resumeUserMessageId
        ? { resumeUserMessageId: data.resumeUserMessageId }
        : {}),
    }
  }

  private static belongsTo(data: StoredHandoff, owner: MothershipHandoffOwner): boolean {
    return typeof owner === 'string'
      ? data.workspaceId === owner && !data.organizationId
      : data.organizationId === owner.organizationId && !data.workspaceId
  }

  static clear(): boolean {
    return BrowserStorage.removeItem(MothershipHandoffStorage.KEY)
  }
}
