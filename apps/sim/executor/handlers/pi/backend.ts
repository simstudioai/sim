/**
 * The seam between the Pi handler and its execution environments. The handler
 * resolves keys, skills, memory, and tools, then hands a {@link PiRunParams} to
 * one backend ({@link PiBackendRun}) selected by `mode`. Backends own only the
 * environment-specific execution (SSH vs E2B) and report progress through
 * {@link PiRunContext.onEvent}.
 */

import type { SSHConnectionConfig } from '@/app/api/tools/ssh/utils'
import type { Message } from '@/executor/handlers/agent/types'
import type { PiEvent, PiRunTotals } from '@/executor/handlers/pi/events'

/** A conversation message seeded into the Pi run (subset of the Agent block's message). */
export type PiMessage = Pick<Message, 'role' | 'content'>

/** A resolved skill (name + full content) made available to Pi. */
export interface PiSkill {
  name: string
  content: string
}

/** SSH connection parameters for local mode (subset of the shared SSH config). */
export type PiSshConnection = Pick<
  SSHConnectionConfig,
  'host' | 'port' | 'username' | 'password' | 'privateKey' | 'passphrase'
>

/** Result of invoking a tool Pi called. */
export interface PiToolResult {
  text: string
  isError: boolean
}

/**
 * A tool exposed to Pi in a backend-neutral shape (the SSH file/bash tools and
 * adapted Sim tools both use it). The local backend converts these into Pi
 * `customTools`; keeping them Pi-SDK-free keeps this seam typed.
 */
export interface PiToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute: (args: Record<string, unknown>) => Promise<PiToolResult>
}

interface PiRunBaseParams {
  model: string
  providerId: string
  apiKey: string
  isBYOK: boolean
  task: string
  thinkingLevel?: string
  skills: PiSkill[]
  initialMessages: PiMessage[]
}

/** Parameters for a local (SSH) Pi run. */
export interface PiLocalRunParams extends PiRunBaseParams {
  mode: 'local'
  ssh: PiSshConnection
  repoPath: string
  tools: PiToolSpec[]
}

/** Parameters for a cloud (E2B) Pi run that opens a PR. */
export interface PiCloudRunParams extends PiRunBaseParams {
  mode: 'cloud'
  owner: string
  repo: string
  githubToken: string
  baseBranch?: string
  branchName?: string
  draft: boolean
  prTitle?: string
  prBody?: string
}

/** Parameters for a cloud (E2B) Pi run that reviews an existing PR. */
export interface PiCloudReviewRunParams extends PiRunBaseParams {
  mode: 'cloud_review'
  owner: string
  repo: string
  githubToken: string
  pullNumber: number
  reviewEvent: 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE'
}

export type PiRunParams = PiLocalRunParams | PiCloudRunParams | PiCloudReviewRunParams

/** Progress callbacks and cancellation passed into a backend run. */
export interface PiRunContext {
  onEvent: (event: PiEvent) => void
  signal?: AbortSignal
}

/** Final result of a Pi run. */
export interface PiRunResult {
  totals: PiRunTotals
  changedFiles?: string[]
  diff?: string
  prUrl?: string
  branch?: string
  reviewUrl?: string
  commentsPosted?: number
}

/** A Pi execution backend. Implemented by the local (SSH) and cloud (E2B) runners. */
export type PiBackendRun<P extends PiRunParams = PiRunParams> = (
  params: P,
  context: PiRunContext
) => Promise<PiRunResult>
