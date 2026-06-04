import type React from 'react'
import { AgentSkillsIcon, WorkflowIcon } from '@/components/icons'
import { formatCreditCost } from '@/lib/billing/credits/conversion'
import type { TraceSpan } from '@/lib/logs/types'
import { LoopTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/loop/loop-config'
import { ParallelTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/parallel/parallel-config'
import { getBlock, getBlockByToolName } from '@/blocks'
import { PROVIDER_DEFINITIONS } from '@/providers/models'
import { normalizeToolId } from '@/tools/normalize'

/**
 * Extracts the bare tool name from an MCP tool id of the form
 * `mcp-{serverId}-{toolName}`. Returns null when the id is not MCP-shaped.
 * Kept local to avoid importing from `@/lib/mcp/utils`, which pulls in
 * `next/server` and breaks client bundles.
 */
function tryParseMcpToolName(toolId: string): string | null {
  if (!toolId.startsWith('mcp-')) return null
  const parts = toolId.split('-')
  if (parts.length < 3) return null
  const toolName = parts.slice(2).join('-')
  return toolName.length > 0 ? toolName : null
}

export const DEFAULT_BLOCK_COLOR = '#6b7280'

export interface BlockIconAndColor {
  icon: React.ComponentType<{ className?: string }> | null
  bgColor: string
}

export function isIterationType(type: string): boolean {
  const lower = type?.toLowerCase() || ''
  return lower === 'loop-iteration' || lower === 'parallel-iteration'
}

export function hasErrorInTree(span: TraceSpan): boolean {
  if (span.status === 'error') return true
  if (span.children?.length) return span.children.some(hasErrorInTree)
  if (span.toolCalls?.length) return span.toolCalls.some((tc) => tc.error)
  return false
}

export function hasUnhandledErrorInTree(span: TraceSpan): boolean {
  if (span.status === 'error' && !span.errorHandled) return true
  if (span.children?.length) return span.children.some(hasUnhandledErrorInTree)
  if (span.toolCalls?.length && !span.errorHandled) return span.toolCalls.some((tc) => tc.error)
  return false
}

export function getBlockIconAndColor(
  type: string,
  toolName?: string,
  provider?: string
): BlockIconAndColor {
  const lowerType = type.toLowerCase()
  if (lowerType === 'tool' && toolName) {
    if (tryParseMcpToolName(toolName)) {
      const mcpBlock = getBlock('mcp')
      if (mcpBlock) return { icon: mcpBlock.icon, bgColor: mcpBlock.bgColor }
    }
    const normalized = normalizeToolId(toolName)
    if (normalized === 'load_skill') return { icon: AgentSkillsIcon, bgColor: '#8B5CF6' }
    const toolBlock = getBlockByToolName(normalized)
    if (toolBlock) return { icon: toolBlock.icon, bgColor: toolBlock.bgColor }
  }
  if (lowerType === 'loop' || lowerType === 'loop-iteration')
    return { icon: LoopTool.icon, bgColor: LoopTool.bgColor }
  if (lowerType === 'parallel' || lowerType === 'parallel-iteration')
    return { icon: ParallelTool.icon, bgColor: ParallelTool.bgColor }
  if (lowerType === 'workflow') return { icon: WorkflowIcon, bgColor: '#6366F1' }
  if (lowerType === 'model' && provider) {
    const providerDef = PROVIDER_DEFINITIONS[provider]
    if (providerDef?.icon)
      return { icon: providerDef.icon, bgColor: providerDef.color ?? DEFAULT_BLOCK_COLOR }
  }
  const blockType = lowerType === 'model' ? 'agent' : lowerType
  const blockConfig = getBlock(blockType)
  if (blockConfig) return { icon: blockConfig.icon, bgColor: blockConfig.bgColor }
  return { icon: null, bgColor: DEFAULT_BLOCK_COLOR }
}

export function parseTime(value?: string | number | null): number {
  if (!value) return 0
  const ms = typeof value === 'number' ? value : new Date(value).getTime()
  return Number.isFinite(ms) ? ms : 0
}

export function formatTokenCount(value: number | undefined): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return value.toLocaleString('en-US')
}

export function formatTtft(ms: number | undefined): string | undefined {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return undefined
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

export function formatTps(
  outputTokens: number | undefined,
  durationMs: number
): string | undefined {
  if (typeof outputTokens !== 'number' || !(outputTokens > 0)) return undefined
  if (!(durationMs > 0)) return undefined
  const tps = Math.round(outputTokens / (durationMs / 1000))
  return tps > 0 ? `${tps.toLocaleString('en-US')} tok/s` : undefined
}

export function getDisplayName(span: TraceSpan): string {
  if (span.type?.toLowerCase() === 'tool') {
    const mcpToolName = tryParseMcpToolName(span.name)
    if (mcpToolName) return mcpToolName
    return normalizeToolId(span.name)
  }
  return span.name
}

export function formatCostAmount(value: number | undefined): string | undefined {
  return formatCreditCost(value, { emptyForZeroOrLess: true })
}

export function formatTokensSummary(tokens: TraceSpan['tokens']): string | undefined {
  if (!tokens) return undefined
  const parts: string[] = []
  const input = formatTokenCount(tokens.input)
  const output = formatTokenCount(tokens.output)
  const total = formatTokenCount(tokens.total)
  const cacheRead = formatTokenCount(tokens.cacheRead)
  const cacheWrite = formatTokenCount(tokens.cacheWrite)
  const reasoning = formatTokenCount(tokens.reasoning)
  if (input) parts.push(`${input} in`)
  if (cacheRead) parts.push(`${cacheRead} cached`)
  if (cacheWrite) parts.push(`${cacheWrite} cache write`)
  if (output) parts.push(`${output} out`)
  if (reasoning) parts.push(`${reasoning} reasoning`)
  if (total) parts.push(`${total} total`)
  return parts.length > 0 ? parts.join(' · ') : undefined
}
