"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { useExecutionStore } from '@/stores/execution/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowExecution } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-workflow-execution'
import { useCurrentWorkflow } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-current-workflow'
import { getBlock } from '@/blocks'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { BlockPathCalculator } from '@/lib/block-path-calculator'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { extractFieldsFromSchema, parseResponseFormatSafely } from '@/lib/response-format'
import { getTrigger, getTriggersByProvider } from '@/triggers'
import { getTool } from '@/tools/utils'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useVariablesStore } from '@/stores/panel/variables/store'
import { useEnvironmentStore } from '@/stores/settings/environment/store'
import { 
  Play, 
  FastForward, 
  Square, 
  Circle,
  AlertCircle,
  Check,
  X,
  CircleDot
} from 'lucide-react'

export function DebugPanel() {
  const {
    isDebugging,
    pendingBlocks,
    debugContext,
    executor,
    activeBlockIds,
    setActiveBlocks,
    setPanelFocusedBlockId,
    panelFocusedBlockId,
    setExecutingBlockIds,
    setDebugContext,
    setPendingBlocks,
  } = useExecutionStore()
  const { activeWorkflowId, workflows } = useWorkflowRegistry()
  const { handleStepDebug, handleResumeDebug, handleCancelDebug, handleRunWorkflow } = useWorkflowExecution()
  const currentWorkflow = useCurrentWorkflow()

  const [chatMessage, setChatMessage] = useState('')
  const [scopedVariables, setScopedVariables] = useState(true)
  const [expandedFields, setExpandedFields] = useState<Set<string>>(new Set())
  const hasStartedRef = useRef(false)
  const lastFocusedIdRef = useRef<string | null>(null)
  // Breakpoint state
  const [breakpointId, setBreakpointId] = useState<string | null>(null)

  // Track bottom variables tab and row highlighting for navigation from tokens
  const [bottomTab, setBottomTab] = useState<'reference' | 'workflow' | 'environment'>('reference')
  const workflowVarRowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map())
  const envVarRowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map())
  const [highlightedWorkflowVar, setHighlightedWorkflowVar] = useState<string | null>(null)
  const [highlightedEnvVar, setHighlightedEnvVar] = useState<string | null>(null)
  const refVarRowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map())
  const [highlightedRefVar, setHighlightedRefVar] = useState<string | null>(null)

  // Helper to format strings with clickable var/env tokens
  const renderWithTokens = (
    text: string,
    options?: { truncateAt?: number }
  ) => {
    const truncateAt = options?.truncateAt
    let displayText = text
    let truncated = false
    if (typeof truncateAt === 'number' && text.length > truncateAt) {
      displayText = text.slice(0, truncateAt) + '...'
      truncated = true
    }

    // Build combined matches for env ({{VAR}}), workflow vars (<variable.name>), and references (<block.path>)
    const matches: Array<{ start: number; end: number; type: 'env' | 'var' | 'ref'; value: string; raw?: string }> = []

    const envRe = /\{\{([^{}]+)\}\}/g
    const varRe = /<variable\.([^>]+)>/g
    const refRe = /<([^>]+)>/g

    let m: RegExpExecArray | null
    while ((m = envRe.exec(displayText)) !== null) {
      matches.push({ start: m.index, end: m.index + m[0].length, type: 'env', value: m[1], raw: m[0] })
    }
    while ((m = varRe.exec(displayText)) !== null) {
      matches.push({ start: m.index, end: m.index + m[0].length, type: 'var', value: m[1], raw: m[0] })
    }
    while ((m = refRe.exec(displayText)) !== null) {
      const inner = m[1]
      // Skip workflow variable tokens since already captured
      if (inner.startsWith('variable.')) continue
      matches.push({ start: m.index, end: m.index + m[0].length, type: 'ref', value: inner, raw: m[0] })
    }

    if (matches.length === 0) {
      return (
        <span className='text-[11px] font-mono text-foreground/70 break-words'>
          {displayText}
        </span>
      )
    }

    // Sort by start index
    matches.sort((a, b) => a.start - b.start)

    const parts: React.ReactNode[] = []
    let cursor = 0

    const handleTokenClick = (kind: 'env' | 'var' | 'ref', rawName: string, rawToken?: string) => {
      if (kind === 'env') {
        setBottomTab('environment')
        // Scroll and highlight
        requestAnimationFrame(() => {
          const row = envVarRowRefs.current.get(rawName)
          if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' })
          setHighlightedEnvVar(rawName)
          setTimeout(() => setHighlightedEnvVar((prev) => (prev === rawName ? null : prev)), 2500)
        })
      } else {
        if (kind === 'var') {
          const normalized = (rawName || '').replace(/\s+/g, '')
          setBottomTab('workflow')
          requestAnimationFrame(() => {
            const row = workflowVarRowRefs.current.get(normalized)
            if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' })
            setHighlightedWorkflowVar(normalized)
            setTimeout(
              () => setHighlightedWorkflowVar((prev) => (prev === normalized ? null : prev)),
              2500
            )
          })
        } else {
          // Reference variable token
          const refKey = rawToken || `<${rawName}>`
          setBottomTab('reference')
          // Keep current scoped state to match the same set user is seeing
          requestAnimationFrame(() => {
            const row = refVarRowRefs.current.get(refKey)
            if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' })
            setHighlightedRefVar(refKey)
            setTimeout(
              () => setHighlightedRefVar((prev) => (prev === refKey ? null : prev)),
              4000
            )
          })
        }
      }
    }

    for (const match of matches) {
      if (match.start > cursor) {
        parts.push(
          <span key={`t-${cursor}`} className='text-[11px] font-mono text-foreground/70 break-words'>
            {displayText.slice(cursor, match.start)}
          </span>
        )
      }

      const chip = (
        <button
          key={`m-${match.start}`}
          type='button'
          className='rounded bg-blue-50 dark:bg-blue-900/20 px-1.5 py-0.5 font-mono text-[11px] text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors'
          onClick={(e) => {
            e.stopPropagation()
            handleTokenClick(match.type as any, match.value, match.raw)
          }}
        >
          {match.type === 'env' ? `{{${match.value}}}` : match.type === 'var' ? `<variable.${match.value}>` : `<${match.value}>`}
        </button>
      )

      parts.push(chip)
      cursor = match.end
    }

    if (cursor < displayText.length) {
      parts.push(
        <span key={`t-end`} className='text-[11px] font-mono text-foreground/70 break-words'>
          {displayText.slice(cursor)}
        </span>
      )
    }

    return <span className='break-words'>{parts}</span>
  }

  // Helper to toggle field expansion
  const toggleFieldExpansion = (fieldKey: string) => {
    setExpandedFields(prev => {
      const next = new Set(prev)
      if (next.has(fieldKey)) {
        next.delete(fieldKey)
      } else {
        next.add(fieldKey)
      }
      return next
    })
  }

  // Helper to consistently resolve a human-readable block name
  const getDisplayName = (block: any | null | undefined): string => {
    if (!block) return ''
    return block.name || block.metadata?.name || block.type || block.id || ''
  }

  // Always use current workflow blocks as the source of truth
  // This ensures consistency whether debugContext exists or not
  const blocksList = useMemo(() => {
    const blocks = Object.values(currentWorkflow.blocks || {}) as any[]
    return blocks.filter(b => b && b.type) // Filter out invalid blocks
  }, [currentWorkflow.blocks])

  const blockById = useMemo(() => {
    const map = new Map<string, any>()
    for (const b of blocksList) map.set(b.id, b)
    return map
  }, [blocksList])

  const starter = useMemo(() => blocksList.find((b: any) => b.metadata?.id === 'starter' || b.type === 'starter'), [blocksList])
  const starterId = starter?.id || null

  // determine if starter is chat mode in editor state (registry/workflow store keeps subblock values)
  const isChatMode = useMemo(() => {
    if (!activeWorkflowId) return false
    const wf = workflows[activeWorkflowId]
    try {
      const stateBlocks = (wf as any)?.state?.blocks || {}
      const startBlock = Object.values(stateBlocks).find((b: any) => b.type === 'starter') as any
      const value = startBlock?.subBlocks?.startWorkflow?.value
      return value === 'chat'
    } catch {
      return false
    }
  }, [activeWorkflowId, workflows])

  // Determine focused block: prefer explicitly panel-focused (clicked) block,
  // else show first pending; when list empties, keep showing the last focused; initial fallback to starter
  const focusedBlockId = useMemo(() => {
    if (panelFocusedBlockId) return panelFocusedBlockId
    if (pendingBlocks.length > 0) return pendingBlocks[0]!
    if (lastFocusedIdRef.current) return lastFocusedIdRef.current
    if (starterId) return starterId
    return null
  }, [panelFocusedBlockId, pendingBlocks, starterId])

  // Remember last focused and publish highlight when pending list changes
  useEffect(() => {
    if (pendingBlocks.length > 0) {
      const nextId = pendingBlocks[0]!
      lastFocusedIdRef.current = nextId
      setPanelFocusedBlockId(nextId)
    }
  }, [pendingBlocks, setPanelFocusedBlockId])

  // Get the focused block from our consistent data source
  const focusedBlock = focusedBlockId ? blockById.get(focusedBlockId) : null

  // Compute visible subblock values for the focused block based on block state (conditions),
  // not UI modes
  const visibleSubblockValues = useMemo(() => {
    if (!focusedBlockId || !focusedBlock) return {}

    const cfg = getBlock(focusedBlock.type)
    const subBlocks = cfg?.subBlocks || []

    // Get merged state for conditional evaluation
    const allBlocks = useWorkflowStore.getState().blocks
    const merged = mergeSubblockState(allBlocks, activeWorkflowId || undefined, focusedBlockId)[focusedBlockId]
    const stateToUse: Record<string, any> = merged?.subBlocks || {}

    const outputs: Record<string, any> = {}

    for (const sb of subBlocks) {
      // Hidden handling
      if ((sb as any).hidden) continue

      // Only show trigger-config automatically for pure trigger blocks
      if ((sb as any).type === 'trigger-config') {
        const isPureTriggerBlock = (cfg as any)?.triggers?.enabled && cfg?.category === 'triggers'
        if (!isPureTriggerBlock) continue
      }

      // Condition evaluation based on current block state
      const cond = typeof (sb as any).condition === 'function' ? (sb as any).condition() : (sb as any).condition
      if (cond) {
        const fieldValue = stateToUse[cond.field]?.value
        const andFieldValue = cond.and ? stateToUse[cond.and.field]?.value : undefined

        const isValueMatch = Array.isArray(cond.value)
          ? fieldValue != null && (cond.not ? !(cond.value as any[]).includes(fieldValue) : (cond.value as any[]).includes(fieldValue))
          : cond.not
            ? fieldValue !== cond.value
            : fieldValue === cond.value

        const isAndValueMatch = !cond.and
          ? true
          : Array.isArray(cond.and.value)
            ? andFieldValue != null && (cond.and.not ? !(cond.and.value as any[]).includes(andFieldValue) : (cond.and.value as any[]).includes(andFieldValue))
            : cond.and.not
              ? andFieldValue !== cond.and.value
              : andFieldValue === cond.and.value

        if (!(isValueMatch && isAndValueMatch)) continue
      }

      // Include only visible subblock values (use the .value for display)
      if (stateToUse[sb.id] && 'value' in stateToUse[sb.id]) {
        outputs[sb.id] = stateToUse[sb.id].value
      }
    }

    return outputs
  }, [focusedBlockId, focusedBlock, activeWorkflowId])

  // Latest log for selected block (for input) - requires debugContext
  const focusedLog = useMemo(() => {
    if (!debugContext?.blockLogs || !focusedBlockId) return null
    const logs = debugContext.blockLogs.filter((l) => l.blockId === focusedBlockId)
    if (logs.length === 0) return null
    return logs.reduce((a, b) => (new Date(a.startedAt) > new Date(b.startedAt) ? a : b))
  }, [debugContext?.blockLogs, focusedBlockId])

  // Upstream executed outputs to approximate available inputs for non-executed blocks
  const upstreamExecuted = useMemo(() => {
    if (!focusedBlockId || !debugContext) return [] as Array<{ id: string; name: string; output: any }>
    
    // Use currentWorkflow.edges for connections (consistent with block source)
    const connections = currentWorkflow.edges || []
    const incoming = connections.filter((c: any) => c.target === focusedBlockId)
    const upstreamIds = new Set<string>(incoming.map((c: any) => c.source))
    const items: Array<{ id: string; name: string; output: any }> = []
    upstreamIds.forEach((id) => {
      const state = debugContext.blockStates.get(id)
      if (state?.executed) {
        const blk = blockById.get(id)
        items.push({ id, name: blk?.metadata?.name || blk?.id || id, output: state.output })
      }
    })
    return items
  }, [focusedBlockId, debugContext, blockById, currentWorkflow.edges])

  const envVars = debugContext?.environmentVariables || {}
  const workflowVars = debugContext?.workflowVariables || {}

  // Get environment variables from the store (for before execution starts)
  const envVarsFromStore = useEnvironmentStore((state) => state.getAllVariables())
  const loadEnvironmentVariables = useEnvironmentStore((state) => state.loadEnvironmentVariables)
  
  // Load environment variables when component mounts
  useEffect(() => {
    loadEnvironmentVariables()
  }, [loadEnvironmentVariables])
  
  // Use debugContext env vars if available (during execution), otherwise use store
  const allEnvVars = useMemo(() => {
    // If we have debugContext with env vars, use those (they're decrypted)
    if (debugContext && Object.keys(envVars).length > 0) {
      return envVars
    }
    
    // Otherwise, use the env vars from the store
    // Convert from store format to simple key-value pairs
    const storeVars: Record<string, string> = {}
    Object.entries(envVarsFromStore).forEach(([key, variable]) => {
      storeVars[key] = variable.value
    })
    return storeVars
  }, [debugContext, envVars, envVarsFromStore])

  // Get workflow variables from the variables store
  const workflowVariablesFromStore = useVariablesStore((state) => 
    activeWorkflowId ? state.getVariablesByWorkflowId(activeWorkflowId) : []
  )

  const isFocusedExecuted = debugContext ? !!debugContext?.blockStates.get(focusedBlockId || '')?.executed : false
  const isStarterFocused = focusedBlock?.metadata?.id === 'starter' || focusedBlock?.type === 'starter'
  const isFocusedCurrent = pendingBlocks.includes(focusedBlockId || '')

  // Bump when execution progresses to refresh dependent memos
  const executionVersion = useMemo(() => {
    const logsCount = debugContext?.blockLogs?.length || 0
    const statesCount = debugContext?.blockStates?.size || 0
    return logsCount + statesCount
  }, [debugContext?.blockLogs?.length, debugContext?.blockStates?.size])

  // Resolved output key-value pairs: keys from schema (or actual output if schema empty),
  // values from debugContext if available, else null
  const resolvedOutputKVs = useMemo(() => {
    if (!focusedBlock) return {}
    const cfg = getBlock(focusedBlock.type)
    const schema = cfg?.outputs || {}
    const stateOutput = debugContext?.blockStates.get(focusedBlockId || '')?.output || {}

    const keys = Object.keys(schema).length > 0 ? Object.keys(schema) : Object.keys(stateOutput)
    const result: Record<string, any> = {}
    keys.forEach((k) => {
      result[k] = Object.prototype.hasOwnProperty.call(stateOutput, k) ? stateOutput[k] : null
    })
    return result
  }, [focusedBlock, focusedBlockId, executionVersion])

  // Compute accessible output variables for the focused block with tag-style references
  const outputVariableEntries = useMemo(() => {
    if (!focusedBlockId) return [] as Array<{ ref: string; value: any }>

    const normalizeBlockName = (name: string) => (name || '').replace(/\s+/g, '').toLowerCase()
    const getSubBlockValue = (blockId: string, property: string): any => {
      return useSubBlockStore.getState().getValue(blockId, property)
    }
    const generateOutputPaths = (outputs: Record<string, any>, prefix = ''): string[] => {
      const paths: string[] = []
      for (const [key, value] of Object.entries(outputs || {})) {
        const current = prefix ? `${prefix}.${key}` : key
        if (typeof value === 'string') {
          paths.push(current)
        } else if (value && typeof value === 'object') {
          if ('type' in value && typeof (value as any).type === 'string') {
            paths.push(current)
            if ((value as any).type === 'object' && (value as any).properties) {
              paths.push(...generateOutputPaths((value as any).properties, current))
            } else if ((value as any).type === 'array' && (value as any).items?.properties) {
              paths.push(...generateOutputPaths((value as any).items.properties, current))
            }
          } else {
            paths.push(...generateOutputPaths(value as Record<string, any>, current))
          }
        } else {
          paths.push(current)
        }
      }
      return paths
    }

    const getAccessiblePathsForBlock = (blockId: string): string[] => {
      const blk = blockById.get(blockId)
      if (!blk) return []
      const cfg = getBlock(blk.type)
      if (!cfg) return []

      // Response format overrides
      const responseFormatValue = getSubBlockValue(blockId, 'responseFormat')
      const responseFormat = parseResponseFormatSafely(responseFormatValue, blockId)
      if (responseFormat) {
        const fields = extractFieldsFromSchema(responseFormat)
        if (fields.length > 0) return fields.map((f: any) => f.name)
      }

      if (blk.type === 'evaluator') {
        const metricsValue = getSubBlockValue(blockId, 'metrics')
        if (metricsValue && Array.isArray(metricsValue) && metricsValue.length > 0) {
          const valid = metricsValue.filter((m: { name?: string }) => m?.name)
          return valid.map((m: { name: string }) => m.name.toLowerCase())
        }
        return generateOutputPaths(cfg.outputs || {})
      }

      if (blk.type === 'starter') {
        const startWorkflowValue = getSubBlockValue(blockId, 'startWorkflow')
        if (startWorkflowValue === 'chat') {
          return ['input', 'conversationId', 'files']
        }
        const inputFormatValue = getSubBlockValue(blockId, 'inputFormat')
        if (inputFormatValue && Array.isArray(inputFormatValue)) {
          return inputFormatValue
            .filter((f: { name?: string }) => f.name && f.name.trim() !== '')
            .map((f: { name: string }) => f.name)
        }
        return []
      }

      if (blk.triggerMode && cfg.triggers?.enabled) {
        const triggerId = cfg?.triggers?.available?.[0]
        const firstTrigger = triggerId ? getTrigger(triggerId) : getTriggersByProvider(blk.type)[0]
        if (firstTrigger?.outputs) {
          return generateOutputPaths(firstTrigger.outputs)
        }
      }

      const operationValue = getSubBlockValue(blockId, 'operation')
      if (operationValue && cfg?.tools?.config?.tool) {
        try {
          const toolId = cfg.tools.config.tool({ operation: operationValue })
          const toolConfig = toolId ? getTool(toolId) : null
          if (toolConfig?.outputs) return generateOutputPaths(toolConfig.outputs)
        } catch {}
      }

      return generateOutputPaths(cfg.outputs || {})
    }

    const edges = currentWorkflow.edges || []
    const accessibleIds = new Set<string>(BlockPathCalculator.findAllPathNodes(edges, focusedBlockId))

    // Always allow referencing the starter block
    if (starterId && starterId !== focusedBlockId) accessibleIds.add(starterId)

    const entries: Array<{ ref: string; value: any }> = []

    for (const id of accessibleIds) {
      const blk = blockById.get(id)
      if (!blk) continue

      const allowedPathsSet = new Set<string>(getAccessiblePathsForBlock(id))
      if (allowedPathsSet.size === 0) continue

      const displayName = getDisplayName(blk)
      const normalizedName = normalizeBlockName(displayName)

      const executedOutput = debugContext?.blockStates.get(id)?.output || {}

      // Flatten executed outputs and include only those matching allowed paths
      const flatten = (obj: any, prefix = ''): Array<{ path: string; value: any }> => {
        if (obj == null || typeof obj !== 'object') return []
        const items: Array<{ path: string; value: any }> = []
        for (const [k, v] of Object.entries(obj)) {
          const current = prefix ? `${prefix}.${k}` : k
          if (v && typeof v === 'object' && !Array.isArray(v)) {
            // include the object level only if explicitly allowed
            if (allowedPathsSet.has(current)) items.push({ path: current, value: v })
            items.push(...flatten(v, current))
          } else {
            if (allowedPathsSet.has(current)) items.push({ path: current, value: v })
          }
        }
        return items
      }

      const executedPairs = flatten(executedOutput)
      for (const { path, value } of executedPairs) {
        entries.push({ ref: `<${normalizedName}.${path}>`, value })
      }
    }

    // Sort for stable UI (by ref)
    entries.sort((a, b) => a.ref.localeCompare(b.ref))
    return entries
  }, [focusedBlockId, currentWorkflow.edges, starterId, blockById, executionVersion])

  // Compute all possible refs from accessible blocks regardless of execution state
  const allPossibleVariableRefs = useMemo(() => {
    if (!focusedBlockId) return new Set<string>()

    const normalizeBlockName = (name: string) => (name || '').replace(/\s+/g, '').toLowerCase()
    const edges = currentWorkflow.edges || []
    const accessibleIds = new Set<string>(BlockPathCalculator.findAllPathNodes(edges, focusedBlockId))
    if (starterId && starterId !== focusedBlockId) accessibleIds.add(starterId)

    const refs = new Set<string>()

    const getAccessiblePathsForBlock = (blockId: string): string[] => {
      const blk = blockById.get(blockId)
      if (!blk) return []
      const cfg = getBlock(blk.type)
      if (!cfg) return []

      const getSubBlockValue = (id: string, property: string): any => {
        return useSubBlockStore.getState().getValue(id, property)
      }

      const generateOutputPaths = (outputs: Record<string, any>, prefix = ''): string[] => {
        const paths: string[] = []
        for (const [key, value] of Object.entries(outputs || {})) {
          const current = prefix ? `${prefix}.${key}` : key
          if (typeof value === 'string') {
            paths.push(current)
          } else if (value && typeof value === 'object') {
            if ('type' in value && typeof (value as any).type === 'string') {
              paths.push(current)
              if ((value as any).type === 'object' && (value as any).properties) {
                paths.push(...generateOutputPaths((value as any).properties, current))
              } else if ((value as any).type === 'array' && (value as any).items?.properties) {
                paths.push(...generateOutputPaths((value as any).items.properties, current))
              }
            } else {
              paths.push(...generateOutputPaths(value as Record<string, any>, current))
            }
          } else {
            paths.push(current)
          }
        }
        return paths
      }

      // Response format overrides
      const responseFormatValue = getSubBlockValue(blockId, 'responseFormat')
      const responseFormat = parseResponseFormatSafely(responseFormatValue, blockId)
      if (responseFormat) {
        const fields = extractFieldsFromSchema(responseFormat)
        if (fields.length > 0) return fields.map((f: any) => f.name)
      }

      if (blk.type === 'evaluator') {
        const metricsValue = getSubBlockValue(blockId, 'metrics')
        if (metricsValue && Array.isArray(metricsValue) && metricsValue.length > 0) {
          const valid = metricsValue.filter((m: { name?: string }) => m?.name)
          return valid.map((m: { name: string }) => m.name.toLowerCase())
        }
        return generateOutputPaths(cfg.outputs || {})
      }

      if (blk.type === 'starter') {
        const startWorkflowValue = getSubBlockValue(blockId, 'startWorkflow')
        if (startWorkflowValue === 'chat') {
          return ['input', 'conversationId', 'files']
        }
        const inputFormatValue = getSubBlockValue(blockId, 'inputFormat')
        if (inputFormatValue && Array.isArray(inputFormatValue)) {
          return inputFormatValue
            .filter((f: { name?: string }) => f.name && f.name.trim() !== '')
            .map((f: { name: string }) => f.name)
        }
        return []
      }

      if (blk.triggerMode && cfg.triggers?.enabled) {
        const triggerId = cfg?.triggers?.available?.[0]
        const firstTrigger = triggerId ? getTrigger(triggerId) : getTriggersByProvider(blk.type)[0]
        if (firstTrigger?.outputs) {
          return generateOutputPaths(firstTrigger.outputs)
        }
      }

      const operationValue = getSubBlockValue(blockId, 'operation')
      if (operationValue && cfg?.tools?.config?.tool) {
        try {
          const toolId = cfg.tools.config.tool({ operation: operationValue })
          const toolConfig = toolId ? getTool(toolId) : null
          if (toolConfig?.outputs) return generateOutputPaths(toolConfig.outputs)
        } catch {}
      }

      return generateOutputPaths(cfg.outputs || {})
    }

    for (const id of accessibleIds) {
      const blk = blockById.get(id)
      if (!blk) continue
      const displayName = getDisplayName(blk)
      const normalizedName = normalizeBlockName(displayName)
      const paths = getAccessiblePathsForBlock(id)
      for (const path of paths) refs.add(`<${normalizedName}.${path}>`)
    }

    return refs
  }, [focusedBlockId, currentWorkflow.edges, starterId, blockById])

  // Filter output variables based on whether they're referenced in the input
  const filteredOutputVariables = useMemo(() => {
    // Build map of available executed entries for quick lookup
    const availableVarsMap = new Map(outputVariableEntries.map(entry => [entry.ref, entry]))

    if (!scopedVariables) {
      // Show all possible upstream refs; mark as resolved if present in executed outputs
      const result: Array<{ ref: string; value: any; resolved: boolean }> = []
      allPossibleVariableRefs.forEach(ref => {
        const available = availableVarsMap.get(ref)
        if (available) {
          result.push({ ...available, resolved: true })
        } else {
          result.push({ ref, value: undefined, resolved: false })
        }
      })
      result.sort((a, b) => {
        if (a.resolved !== b.resolved) return a.resolved ? -1 : 1
        return a.ref.localeCompare(b.ref)
      })
      return result
    }
    
    // Get the JSON string of visible subblock values to search for references
    const inputValuesStr = JSON.stringify(visibleSubblockValues)
    
    // Extract all variable references from the input using regex
    // Matches patterns like <blockname.property> or <blockname.nested.property>
    const referencePattern = /<([^>]+)>/g
    const referencedVars = new Set<string>()
    let match
    while ((match = referencePattern.exec(inputValuesStr)) !== null) {
      const fullMatch = match[0] // Full reference including < >
      const innerContent = match[1] // Content between < >
      
      // Exclude workflow variable references (pattern: variable.something)
      if (!innerContent.startsWith('variable.')) {
        referencedVars.add(fullMatch)
      }
    }
    
    // Build the final list with both resolved and unresolved variables
    const result: Array<{ ref: string; value: any; resolved: boolean }> = []
    
    // Add all referenced variables (excluding workflow variables)
    for (const ref of referencedVars) {
      const available = availableVarsMap.get(ref)
      if (available) {
        // Variable is resolved (has a value)
        result.push({ ...available, resolved: true })
      } else {
        // Variable is unresolved (referenced but no value yet)
        result.push({ ref, value: undefined, resolved: false })
      }
    }
    
    // Sort: resolved first, then unresolved, then alphabetically by ref
    result.sort((a, b) => {
      if (a.resolved !== b.resolved) {
        return a.resolved ? -1 : 1
      }
      return a.ref.localeCompare(b.ref)
    })
    return result
  }, [outputVariableEntries, scopedVariables, visibleSubblockValues, executionVersion, allPossibleVariableRefs])

  // Filter workflow variables based on whether they're referenced in the input
  const filteredWorkflowVariables = useMemo(() => {
    // Get all workflow variables from the store
    const storeVariables = workflowVariablesFromStore
    
    if (!scopedVariables) {
      // Show all workflow variables from the store
      return storeVariables.map(variable => ({
        id: variable.id,
        name: variable.name,
        value: variable.value,
        type: variable.type
      }))
    }
    
    // For scoped view, look at the entire focused block's data
    // This includes all subBlocks values, not just the visible ones
    if (!focusedBlock) {
      return []
    }
    
    // Get all subblock values from the store for this block
    const allSubBlockValues: Record<string, any> = {}
    if (focusedBlockId && activeWorkflowId) {
      const allBlocks = useWorkflowStore.getState().blocks
      const merged = mergeSubblockState(allBlocks, activeWorkflowId, focusedBlockId)[focusedBlockId]
      const stateToUse = merged?.subBlocks || {}
      
      // Extract all values from subBlocks
      for (const [key, subBlock] of Object.entries(stateToUse)) {
        if (subBlock && typeof subBlock === 'object' && 'value' in subBlock) {
          allSubBlockValues[key] = subBlock.value
        }
      }
    }
    
    // Search for workflow variable references in all subblock values
    const blockDataStr = JSON.stringify(allSubBlockValues)
    
    // Extract workflow variable references using pattern <variable.name>
    const variablePattern = /<variable\.([^>]+)>/g
    const referencedVarNames = new Set<string>()
    let match
    while ((match = variablePattern.exec(blockDataStr)) !== null) {
      referencedVarNames.add(match[1]) // Add just the variable name part
    }
    
    // Filter workflow variables to only those referenced
    return storeVariables.filter(variable => {
      // Normalize the variable name (remove spaces) to match how it's referenced
      const normalizedName = (variable.name || '').replace(/\s+/g, '')
      return referencedVarNames.has(normalizedName)
    }).map(variable => ({
      id: variable.id,
      name: variable.name,
      value: variable.value,
      type: variable.type
    }))
  }, [workflowVariablesFromStore, scopedVariables, focusedBlock, focusedBlockId, activeWorkflowId])

  // Filter environment variables based on whether they're referenced in the input
  const filteredEnvVariables = useMemo(() => {
    // Helper function to recursively extract env var references from any value
    const extractEnvVarReferences = (value: any, fieldName?: string): Set<string> => {
      const refs = new Set<string>()
      
      if (typeof value === 'string') {
        // Check if this is an API key field (by field name)
        const isApiKeyField = fieldName && (
          fieldName.toLowerCase().includes('apikey') ||
          fieldName.toLowerCase().includes('api_key') ||
          fieldName.toLowerCase().includes('secretkey') ||
          fieldName.toLowerCase().includes('secret_key') ||
          fieldName.toLowerCase().includes('accesskey') ||
          fieldName.toLowerCase().includes('access_key') ||
          fieldName.toLowerCase().includes('token')
        )
        
        // Check if entire string is just {{ENV_VAR}}
        const isExplicitEnvVar = value.trim().match(/^\{\{[^{}]+\}\}$/)
        
        // Check for env vars in specific contexts (Bearer tokens, URLs, headers, etc.)
        const hasProperContext = 
          /Bearer\s+\{\{[^{}]+\}\}/i.test(value) ||
          /Authorization:\s+Bearer\s+\{\{[^{}]+\}\}/i.test(value) ||
          /Authorization:\s+\{\{[^{}]+\}\}/i.test(value) ||
          /[?&]api[_-]?key=\{\{[^{}]+\}\}/i.test(value) ||
          /[?&]key=\{\{[^{}]+\}\}/i.test(value) ||
          /[?&]token=\{\{[^{}]+\}\}/i.test(value) ||
          /X-API-Key:\s+\{\{[^{}]+\}\}/i.test(value) ||
          /api[_-]?key:\s+\{\{[^{}]+\}\}/i.test(value)
        
        // Extract env vars if this field should be processed
        if (isApiKeyField || isExplicitEnvVar || hasProperContext) {
          const envPattern = /\{\{([^}]+)\}\}/g
          let match
          while ((match = envPattern.exec(value)) !== null) {
            refs.add(match[1])
          }
        }
      } else if (Array.isArray(value)) {
        // Recursively process arrays
        value.forEach((item, index) => {
          const itemRefs = extractEnvVarReferences(item, fieldName ? `${fieldName}[${index}]` : undefined)
          itemRefs.forEach(ref => refs.add(ref))
        })
      } else if (value && typeof value === 'object') {
        // Recursively process objects
        Object.entries(value).forEach(([key, val]) => {
          const itemRefs = extractEnvVarReferences(val, key)
          itemRefs.forEach(ref => refs.add(ref))
        })
      }
      
      return refs
    }
    
    if (!scopedVariables) {
      // Show all environment variables that are referenced anywhere in the workflow
      const allEnvVarRefs = new Set<string>()
      
      for (const block of blocksList) {
        if (activeWorkflowId) {
          const allBlocks = useWorkflowStore.getState().blocks
          const merged = mergeSubblockState(allBlocks, activeWorkflowId, block.id)[block.id]
          const stateToUse = merged?.subBlocks || {}
          
          // Process each subblock value with its field name
          for (const [key, subBlock] of Object.entries(stateToUse)) {
            if (subBlock && typeof subBlock === 'object' && 'value' in subBlock) {
              const refs = extractEnvVarReferences(subBlock.value, key)
              refs.forEach(ref => allEnvVarRefs.add(ref))
            }
          }
        }
      }
      
      // Return only env vars that are referenced somewhere in the workflow
      return Object.entries(allEnvVars).filter(([key]) => allEnvVarRefs.has(key))
    }
    
    // For scoped view, look at the entire focused block's data
    if (!focusedBlock) {
      return []
    }
    
    // Get all subblock values from the store for this block
    const blockEnvVarRefs = new Set<string>()
    if (focusedBlockId && activeWorkflowId) {
      const allBlocks = useWorkflowStore.getState().blocks
      const merged = mergeSubblockState(allBlocks, activeWorkflowId, focusedBlockId)[focusedBlockId]
      const stateToUse = merged?.subBlocks || {}
      
      // Process each subblock value with its field name
      for (const [key, subBlock] of Object.entries(stateToUse)) {
        if (subBlock && typeof subBlock === 'object' && 'value' in subBlock) {
          const refs = extractEnvVarReferences(subBlock.value, key)
          refs.forEach(ref => blockEnvVarRefs.add(ref))
        }
      }
    }
    
    // Filter environment variables to only those referenced
    return Object.entries(allEnvVars).filter(([key]) => blockEnvVarRefs.has(key))
  }, [allEnvVars, scopedVariables, focusedBlock, focusedBlockId, activeWorkflowId, blocksList])

  // Reset hasStartedRef when debug mode is deactivated
  useEffect(() => {
    if (!isDebugging) {
      hasStartedRef.current = false
      setPanelFocusedBlockId(null)
    }
  }, [isDebugging, setPanelFocusedBlockId])

  if (!isDebugging) {
    return (
      <div className='flex h-full flex-col items-center justify-center px-6'>
        <div className='flex flex-col items-center gap-3'>
          <div className='rounded-full bg-muted/50 p-4'>
            <AlertCircle className='h-8 w-8 text-muted-foreground/60' />
          </div>
          <p className='text-muted-foreground text-sm font-medium'>Debug mode inactive</p>
          <p className='text-center text-muted-foreground/70 text-xs'>
            Enable debug mode to step through workflow execution
          </p>
        </div>
      </div>
    )
  }

  // Step handler: handles both initial and subsequent steps
  const handleStep = async () => {
    if (!hasStartedRef.current && !debugContext) {
      hasStartedRef.current = true
      if (isChatMode) {
        const text = chatMessage.trim()
        if (!text) {
          hasStartedRef.current = false
          return
        }
        await handleRunWorkflow({ input: text, conversationId: crypto.randomUUID() }, true)
      } else {
        await handleRunWorkflow(undefined, true)
      }
      return
    }

    await handleStepDebug()
  }

  // Restart handler: reset to initial state without starting execution
  const handleRestart = async () => {
    // Do not toggle debug mode off; just reset execution/debug state
    hasStartedRef.current = false
    lastFocusedIdRef.current = null
    setBreakpointId(null)
    setExecutingBlockIds(new Set())
    setActiveBlocks(new Set())
    setPendingBlocks([])
    setDebugContext(null)
    setPanelFocusedBlockId(starterId || null)
    // Ensure executor is cleared so next Step re-initializes fresh
    useExecutionStore.getState().setExecutor(null)
    // Mark starter as current pending for UI so it shows as Current (no execution started)
    if (starterId) {
      setPendingBlocks([starterId])
    }
  }

  // Resume-until-breakpoint handler
  const handleResumeUntilBreakpoint = async () => {
    // If not started yet, initialize the executor (same as first Step)
    if (!useExecutionStore.getState().debugContext && !hasStartedRef.current) {
      hasStartedRef.current = true
      if (isChatMode) {
        const text = chatMessage.trim()
        if (!text) {
          hasStartedRef.current = false
          return
        }
        await handleRunWorkflow({ input: text, conversationId: crypto.randomUUID() }, true)
      } else {
        await handleRunWorkflow(undefined, true)
      }
      // Wait for initialization to populate executor/debugContext/pendingBlocks
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
      let attempts = 0
      while (attempts < 40) { // ~2s max
        const st = useExecutionStore.getState()
        if (st.executor && st.debugContext && Array.isArray(st.pendingBlocks)) break
        await wait(50)
        attempts++
      }
    }

    // Use freshest store state after init
    let exec = useExecutionStore.getState().executor
    let ctx = useExecutionStore.getState().debugContext
    let pend = [...useExecutionStore.getState().pendingBlocks]

    if (!exec || !ctx) return

    try {
      let iteration = 0
      const maxIterations = 1000
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

      while (iteration < maxIterations) {
        // Refresh latest state each iteration to avoid stale refs
        const st = useExecutionStore.getState()
        exec = st.executor
        ctx = st.debugContext
        pend = [...st.pendingBlocks]
        if (!exec || !ctx) break

        // Determine executable set
        const executable = breakpointId ? pend.filter((id) => id !== breakpointId) : pend
        if (executable.length === 0) break

        setExecutingBlockIds(new Set(executable))
        const result = await exec.continueExecution(executable, ctx)
        setExecutingBlockIds(new Set())

        if (result?.metadata?.context) {
          setDebugContext(result.metadata.context)
        }
        if (result?.metadata?.pendingBlocks) {
          setPendingBlocks(result.metadata.pendingBlocks)
        } else {
          break
        }
        if (!result?.metadata?.isDebugSession) break

        iteration++
        // allow UI/state to settle
        await wait(10)
      }
    } catch (e) {
      // Swallow to avoid double error surfaces in UI
    }
  }

  const getStatusIcon = () => {
    if (isFocusedCurrent) return <Circle className='h-2 w-2 fill-emerald-500 text-emerald-500' />
    if (isFocusedExecuted) return <Circle className='h-2 w-2 fill-blue-500 text-blue-500' />
    return <Circle className='h-2 w-2 fill-muted-foreground/40 text-muted-foreground/40' />
  }

  const getStatusText = () => {
    if (isFocusedCurrent) return 'Current'
    if (isFocusedExecuted) return 'Executed'
    return 'Pending'
  }

  const getResolutionIcon = () => {
    const resolvedCount = filteredOutputVariables.filter(v => v.resolved).length
    const unresolvedCount = filteredOutputVariables.filter(v => !v.resolved).length
    
    if (unresolvedCount === 0) {
      // All resolved - green check
      return <Check className='h-3 w-3 text-emerald-500' />
    } else if (isFocusedCurrent) {
      // Current block with unresolved variables - red X
      return <X className='h-3 w-3 text-destructive' />
    } else {
      // Not current but has unresolved variables - yellow dot
      return <Circle className='h-3 w-3 fill-yellow-500 text-yellow-500' />
    }
  }

  return (
    <div className='flex h-full flex-col'>
      {/* Header Section - Single Line */}
      <div className='border-b border-border/50 px-3 py-2.5'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2 min-w-0'>
            <span className='font-semibold text-sm truncate'>
              {getDisplayName(focusedBlock) || 'No block selected'}
            </span>
            {focusedBlock && (
              <>
                <span className='text-muted-foreground/50'>•</span>
                <span className='text-muted-foreground text-xs'>
                  {focusedBlock.type}
                </span>
                {breakpointId === focusedBlockId && (
                  <span className='ml-1 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-1.5 py-0.5 text-[10px]'>
                    Breakpoint
                  </span>
                )}
              </>
            )}
          </div>
          <div className='flex items-center gap-1.5 flex-shrink-0'>
            {getStatusIcon()}
            <span className='text-muted-foreground text-xs'>{getStatusText()}</span>
          </div>
        </div>
      </div>

      {/* Controls Section */}
      <div className='border-b border-border/50 p-3'>
        {isChatMode && !hasStartedRef.current && (
          <div className='mb-3'>
            <Textarea
              placeholder='Enter message to start debugging...'
              value={chatMessage}
              onChange={(e) => setChatMessage(e.target.value)}
              className='min-h-[60px] resize-none border-border/50 bg-background/50 placeholder:text-muted-foreground/50'
            />
          </div>
        )}
        <div className='flex items-center gap-2'>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size='sm'
                  variant='outline'
                  onClick={handleStep}
                  className='gap-2 border-border/50 hover:bg-muted/50'
                >
                  <Play className='h-3.5 w-3.5' />
                  Step
                </Button>
              </TooltipTrigger>
              <TooltipContent>Execute next step</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size='sm'
                  variant='outline'
                  onClick={handleResumeUntilBreakpoint}
                  disabled={isChatMode ? (!hasStartedRef.current && chatMessage.trim() === '') : false}
                  className='gap-2 border-border/50 hover:bg-muted/50 disabled:opacity-40'
                >
                  <FastForward className='h-3.5 w-3.5' />
                  Resume
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {breakpointId ? 'Continue until breakpoint' : 'Continue execution'}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size='sm'
                  variant='outline'
                  onClick={handleRestart}
                  className='gap-2 border-border/50 hover:bg-muted/50'
                >
                  <Circle className='h-3.5 w-3.5' />
                  Restart
                </Button>
              </TooltipTrigger>
              <TooltipContent>Restart from the beginning</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size='sm'
                  variant={breakpointId === focusedBlockId ? 'default' : 'outline'}
                  onClick={() => setBreakpointId(breakpointId === focusedBlockId ? null : (focusedBlockId || null))}
                  disabled={!focusedBlockId}
                  className='gap-2 border-border/50 hover:bg-muted/50 disabled:opacity-40'
                >
                  <CircleDot className={cn('h-3.5 w-3.5', breakpointId === focusedBlockId ? 'text-amber-600' : '')} />
                  Breakpoint
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {breakpointId === focusedBlockId ? 'Remove breakpoint' : 'Set breakpoint at current block'}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size='sm'
                  variant='outline'
                  onClick={handleCancelDebug}
                  className='gap-2 border-border/50 hover:bg-destructive/10 hover:text-destructive'
                >
                  <Square className='h-3.5 w-3.5' />
                  Stop
                </Button>
              </TooltipTrigger>
              <TooltipContent>Stop debugging</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Main Content Area - Split into two sections */}
      <div className='flex flex-1 flex-col overflow-hidden'>
        {/* Top Section - Input/Output */}
        <div className='flex-1 min-h-0 border-b border-border/50'>
          <Tabs defaultValue='input' className='flex h-full flex-col'>
            <div className='border-b border-border/50 px-3'>
              <TabsList className='h-10 bg-transparent p-0 gap-6'>
                <TabsTrigger
                  value='input'
                  className='h-10 rounded-none border-b-2 border-transparent px-0 pb-2.5 pt-3 text-xs font-medium text-muted-foreground transition-all data-[state=active]:border-foreground data-[state=active]:text-foreground data-[state=active]:shadow-none'
                >
                    Input
                  </TabsTrigger>
                <TabsTrigger
                  value='output'
                  className='h-10 rounded-none border-b-2 border-transparent px-0 pb-2.5 pt-3 text-xs font-medium text-muted-foreground transition-all data-[state=active]:border-foreground data-[state=active]:text-foreground data-[state=active]:shadow-none'
                >
                    Output
                  </TabsTrigger>
                </TabsList>
              </div>

            <TabsContent value='input' className='flex-1 overflow-auto p-3 m-0'>
                {Object.keys(visibleSubblockValues).length > 0 ? (
                <div className='h-full overflow-y-scroll overflow-x-hidden'>
                  <table className='w-full table-fixed'>
                    <colgroup>
                      <col className='w-[30%] min-w-[120px]' />
                      <col className='w-[70%]' />
                    </colgroup>
                    <thead className='sticky top-0 bg-background z-10'>
                      <tr className='border-b border-border/50'>
                        <th className='px-3 py-2 text-left text-xs font-medium text-muted-foreground bg-background'>Field</th>
                        <th className='px-3 py-2 text-left text-xs font-medium text-muted-foreground bg-background'>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(visibleSubblockValues).map(([key, value]) => {
                        const fieldKey = `input-${key}`
                        const isExpanded = expandedFields.has(fieldKey)
                        
                        return (
                          <tr key={key} className='border-b border-border/30 hover:bg-muted/20'>
                            <td className='px-3 py-2 align-top'>
                              <code className='font-mono text-[11px] text-foreground/80 break-words'>{key}</code>
                            </td>
                            <td className='px-3 py-2'>
                              <div className='w-full overflow-hidden'>
                                {typeof value === 'object' && value !== null ? (
                                  <div 
                                    className='cursor-pointer'
                                    onClick={() => toggleFieldExpansion(fieldKey)}
                                  >
                                    {isExpanded ? (
                                      <pre className='text-[11px] font-mono text-foreground/70 whitespace-pre-wrap break-words overflow-x-auto'>
{JSON.stringify(value, null, 2)}
                    </pre>
                                    ) : (
                                      <span className='text-[11px] font-mono text-muted-foreground hover:text-foreground block truncate'>
                                        {JSON.stringify(value).slice(0, 100)}...
                                      </span>
                                    )}
                                  </div>
                                ) : typeof value === 'boolean' ? (
                                  <span className={cn(
                                    'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
                                    value ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400'
                                  )}>
                                    {String(value)}
                                  </span>
                                ) : value === null || value === undefined ? (
                                  <span className='text-[11px] text-muted-foreground italic'>null</span>
                                ) : String(value).length > 100 ? (
                                  <div
                                    className='cursor-pointer'
                                    onClick={() => toggleFieldExpansion(fieldKey)}
                                  >
                                    {isExpanded ? (
                                      <span className='text-[11px] font-mono text-foreground/70 whitespace-pre-wrap break-words'>
                                        {renderWithTokens(String(value))}
                                      </span>
                                    ) : (
                                      <span className='text-[11px] font-mono text-muted-foreground hover:text-foreground block truncate'>
                                        {renderWithTokens(String(value), { truncateAt: 100 })}
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className='text-[11px] font-mono text-foreground/70 break-words'>
                                    {renderWithTokens(String(value))}
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className='flex h-32 items-center justify-center rounded-lg border border-dashed border-border/50'>
                  <p className='text-muted-foreground/60 text-xs'>No input data available</p>
                </div>
                )}
              </TabsContent>

            <TabsContent value='output' className='flex-1 overflow-auto p-3 m-0'>
                {resolvedOutputKVs && Object.keys(resolvedOutputKVs).length > 0 ? (
                <div className='h-full overflow-y-scroll overflow-x-hidden'>
                  <table className='w-full table-fixed'>
                    <colgroup>
                      <col className='w-[30%] min-w-[120px]' />
                      <col className='w-[70%]' />
                    </colgroup>
                    <thead className='sticky top-0 bg-background z-10'>
                      <tr className='border-b border-border/50'>
                        <th className='px-3 py-2 text-left text-xs font-medium text-muted-foreground bg-background'>Field</th>
                        <th className='px-3 py-2 text-left text-xs font-medium text-muted-foreground bg-background'>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(resolvedOutputKVs).map(([key, value]) => {
                        const fieldKey = `output-${key}`
                        const isExpanded = expandedFields.has(fieldKey)
                        
                        return (
                          <tr key={key} className='border-b border-border/30 hover:bg-muted/20'>
                            <td className='px-3 py-2 align-top'>
                              <code className='font-mono text-[11px] text-foreground/80 break-words'>{key}</code>
                            </td>
                            <td className='px-3 py-2'>
                              <div className='w-full overflow-hidden'>
                                {typeof value === 'object' && value !== null ? (
                                  <div 
                                    className='cursor-pointer'
                                    onClick={() => toggleFieldExpansion(fieldKey)}
                                  >
                                    {isExpanded ? (
                                      <pre className='text-[11px] font-mono text-foreground/70 whitespace-pre-wrap break-words overflow-x-auto'>
{JSON.stringify(value, null, 2)}
                    </pre>
                                    ) : (
                                      <span className='text-[11px] font-mono text-muted-foreground hover:text-foreground block truncate'>
                                        {JSON.stringify(value).slice(0, 100)}...
                                      </span>
                                    )}
                                  </div>
                                ) : typeof value === 'boolean' ? (
                                  <span className={cn(
                                    'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
                                    value ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400'
                                  )}>
                                    {String(value)}
                                  </span>
                                ) : value === null || value === undefined ? (
                                  <span className='text-[11px] text-muted-foreground italic'>
                                    {value === null ? 'null' : 'undefined'}
                                  </span>
                                ) : String(value).length > 100 ? (
                                  <div
                                    className='cursor-pointer'
                                    onClick={() => toggleFieldExpansion(fieldKey)}
                                  >
                                    {isExpanded ? (
                                      <span className='text-[11px] font-mono text-foreground/70 whitespace-pre-wrap break-words'>
                                        {renderWithTokens(String(value))}
                                      </span>
                                    ) : (
                                      <span className='text-[11px] font-mono text-muted-foreground hover:text-foreground block truncate'>
                                        {renderWithTokens(String(value), { truncateAt: 100 })}
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className='text-[11px] font-mono text-foreground/70 break-words'>
                                    {renderWithTokens(String(value))}
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className='flex h-32 items-center justify-center rounded-lg border border-dashed border-border/50'>
                  <p className='text-muted-foreground/60 text-xs'>No output data available</p>
                </div>
                )}
              </TabsContent>
            </Tabs>
          </div>

        {/* Bottom Section - Variables Tables */}
        <div className='flex-1 min-h-0'>
          <Tabs value={bottomTab} onValueChange={(v) => setBottomTab(v as any)} className='flex h-full flex-col'>
            <div className='border-b border-border/50 px-3 flex items-center justify-between'>
              <TabsList className='h-10 bg-transparent p-0 gap-6'>
                <TabsTrigger
                  value='reference'
                  className='h-10 rounded-none border-b-2 border-transparent px-0 pb-2.5 pt-3 text-xs font-medium text-muted-foreground transition-all data-[state=active]:border-foreground data-[state=active]:text-foreground data-[state=active]:shadow-none'
                >
                  Reference Variables
                  <span className='ml-1.5 text-[10px] text-muted-foreground'>
                    ({filteredOutputVariables.length})
                  </span>
                </TabsTrigger>
                <TabsTrigger
                  value='workflow'
                  className='h-10 rounded-none border-b-2 border-transparent px-0 pb-2.5 pt-3 text-xs font-medium text-muted-foreground transition-all data-[state=active]:border-foreground data-[state=active]:text-foreground data-[state=active]:shadow-none'
                >
                  Workflow Variables
                  <span className='ml-1.5 text-[10px] text-muted-foreground'>
                    ({filteredWorkflowVariables.length})
                  </span>
                </TabsTrigger>
                <TabsTrigger
                  value='environment'
                  className='h-10 rounded-none border-b-2 border-transparent px-0 pb-2.5 pt-3 text-xs font-medium text-muted-foreground transition-all data-[state=active]:border-foreground data-[state=active]:text-foreground data-[state=active]:shadow-none'
                >
                  Environment Variables
                  <span className='ml-1.5 text-[10px] text-muted-foreground'>
                    ({filteredEnvVariables.length})
                  </span>
                </TabsTrigger>
              </TabsList>
              <label className='flex items-center gap-2 cursor-pointer text-xs'>
                <Checkbox 
                  checked={scopedVariables}
                  onCheckedChange={(checked) => setScopedVariables(checked as boolean)}
                  className='h-3.5 w-3.5'
                />
                <span className='text-muted-foreground'>Scoped</span>
              </label>
        </div>

            <TabsContent value='reference' className='flex-1 overflow-auto m-0'>
              <div className='flex flex-col h-full'>
                <div className='flex items-center justify-end px-3 py-2 border-b border-border/50'>
                  <div className='flex items-center gap-1.5'>
                    {scopedVariables && filteredOutputVariables.length > 0 && getResolutionIcon()}
                    <span className='text-[10px] text-muted-foreground'>
                      {scopedVariables ? (
                        `${filteredOutputVariables.filter(v => v.resolved).length} of ${filteredOutputVariables.length}`
                      ) : (
                        `${outputVariableEntries.length}`
                      )} variables
                    </span>
                          </div>
                </div>
                {filteredOutputVariables.length > 0 ? (
                  <div className='flex-1 overflow-y-scroll overflow-x-hidden'>
                    <table className='w-full table-fixed'>
                      <colgroup>
                        <col className='w-[35%] min-w-[150px]' />
                        <col className='w-[65%]' />
                      </colgroup>
                      <thead className='sticky top-0 bg-background z-10'>
                        <tr className='border-b border-border/50'>
                          <th className='px-3 py-2 text-left text-xs font-medium text-muted-foreground bg-background'>Reference</th>
                          <th className='px-3 py-2 text-left text-xs font-medium text-muted-foreground bg-background'>Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredOutputVariables.map(({ ref, value, resolved }) => {
                          const fieldKey = `ref-${ref}`
                          const isExpanded = expandedFields.has(fieldKey)
                          const valueStr = value !== undefined ? JSON.stringify(value, null, 2) : 'undefined'
                          const shouldTruncate = valueStr.length > 600
                          
                          return (
                            <tr
                              key={ref}
                              ref={(el) => {
                                if (el) refVarRowRefs.current.set(ref, el)
                              }}
                              className={cn(
                                'border-b border-border/30',
                                resolved ? 'hover:bg-muted/20' : 'opacity-50',
                                highlightedRefVar === ref && 'bg-amber-100 dark:bg-amber-900/30'
                              )}
                            >
                              <td className='px-3 py-2 align-top'>
                                <code className={cn(
                                  'rounded px-1.5 py-0.5 font-mono text-[11px] break-words',
                                  resolved 
                                    ? 'bg-muted/50 text-foreground/80' 
                                    : 'bg-muted/30 text-muted-foreground'
                                )}>
                                  {ref}
                                </code>
                              </td>
                              <td className='px-3 py-2'>
                                {resolved ? (
                                  shouldTruncate ? (
                                    <div
                                      className='cursor-pointer'
                                      onClick={() => toggleFieldExpansion(fieldKey)}
                                    >
                                      <pre className='text-[11px] font-mono text-foreground/70 whitespace-pre-wrap break-words overflow-x-auto'>
{isExpanded ? valueStr : `${valueStr.slice(0, 600)}...`}
                          </pre>
                        </div>
                                  ) : (
                                    <pre className='text-[11px] font-mono text-foreground/70 whitespace-pre-wrap break-words overflow-x-auto'>
{valueStr}
                                    </pre>
                                  )
                                ) : (
                                  <span className='text-[11px] font-mono text-muted-foreground italic'>
                                    Unresolved
                                  </span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
              </div>
                ) : (
                  <div className='flex flex-1 items-center justify-center'>
                    <p className='text-muted-foreground/60 text-xs'>
                      {scopedVariables && outputVariableEntries.length > 0 
                        ? 'No variables referenced in input' 
                        : 'No reference variables available'}
                    </p>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value='workflow' className='flex-1 overflow-auto m-0'>
              {filteredWorkflowVariables.length > 0 ? (
                <div className='h-full overflow-y-scroll overflow-x-hidden'>
                  <table className='w-full table-fixed'>
                    <colgroup>
                      <col className='w-[35%] min-w-[150px]' />
                      <col className='w-[65%]' />
                    </colgroup>
                    <thead className='sticky top-0 bg-background z-10'>
                      <tr className='border-b border-border/50'>
                        <th className='px-3 py-2 text-left text-xs font-medium text-muted-foreground bg-background'>Variable</th>
                        <th className='px-3 py-2 text-left text-xs font-medium text-muted-foreground bg-background'>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredWorkflowVariables.map((variable) => {
                        const normalizedName = (variable.name || '').replace(/\s+/g, '')
                        const fieldKey = `workflow-${variable.id}`
                        const isExpanded = expandedFields.has(fieldKey)
                        const value = variable.value
                        const valueStr = value !== undefined && value !== null ? JSON.stringify(value, null, 2) : String(value)
                        const shouldTruncate = valueStr.length > 100
                        
                        return (
                          <tr
                            key={variable.id}
                            ref={(el) => {
                              if (el) workflowVarRowRefs.current.set(normalizedName, el)
                            }}
                            className={cn(
                              'border-b border-border/30 hover:bg-muted/20',
                              highlightedWorkflowVar === normalizedName && 'bg-amber-100 dark:bg-amber-900/30'
                            )}
                          >
                            <td className='px-3 py-2 align-top'>
                              <code className='font-mono text-[11px] text-foreground/80 break-words'>{variable.name}</code>
                            </td>
                            <td className='px-3 py-2'>
                              {shouldTruncate ? (
                                <div
                                  className='cursor-pointer'
                                  onClick={() => toggleFieldExpansion(fieldKey)}
                                >
                                  <div className='min-w-0 flex-1'>
                                    <pre className='text-[11px] font-mono text-foreground/70 whitespace-pre-wrap break-words overflow-x-auto'>
                                      {isExpanded ? valueStr : `${valueStr.slice(0, 100)}...`}
                                    </pre>
                                  </div>
                                </div>
                              ) : (
                                <pre className='text-[11px] font-mono text-foreground/70 whitespace-pre-wrap break-words overflow-x-auto'>
                                  {valueStr}
                                </pre>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
              </div>
              ) : (
                <div className='flex h-full items-center justify-center'>
                  <p className='text-muted-foreground/60 text-xs'>
                    {scopedVariables && workflowVariablesFromStore.length > 0
                      ? 'No workflow variables referenced in input'
                      : 'No workflow variables'}
                  </p>
                </div>
              )}
            </TabsContent>

            <TabsContent value='environment' className='flex-1 overflow-auto m-0'>
              {filteredEnvVariables.length > 0 ? (
                <div className='h-full overflow-y-scroll overflow-x-hidden'>
                  <table className='w-full table-fixed'>
                    <colgroup>
                      <col className='w-[35%] min-w-[150px]' />
                      <col className='w-[65%]' />
                    </colgroup>
                    <thead className='sticky top-0 bg-background z-10'>
                      <tr className='border-b border-border/50'>
                        <th className='px-3 py-2 text-left text-xs font-medium text-muted-foreground bg-background'>Variable</th>
                        <th className='px-3 py-2 text-left text-xs font-medium text-muted-foreground bg-background'>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEnvVariables.map(([key, value]) => {
                        const fieldKey = `env-${key}`
                        const isExpanded = expandedFields.has(fieldKey)
                        const valueStr = value !== undefined && value !== null ? JSON.stringify(value, null, 2) : String(value)
                        const shouldTruncate = valueStr.length > 100
                        
                        return (
                          <tr
                            key={key}
                            ref={(el) => {
                              if (el) envVarRowRefs.current.set(key, el)
                            }}
                            className={cn(
                              'border-b border-border/30 hover:bg-muted/20',
                              highlightedEnvVar === key && 'bg-amber-100 dark:bg-amber-900/30'
                            )}
                          >
                            <td className='px-3 py-2 align-top'>
                              <code className='font-mono text-[11px] text-foreground/80 break-words'>{key}</code>
                            </td>
                            <td className='px-3 py-2'>
                              {shouldTruncate ? (
                                <div
                                  className='cursor-pointer'
                                  onClick={() => toggleFieldExpansion(fieldKey)}
                                >
                                  <div className='min-w-0 flex-1'>
                                    <pre className='text-[11px] font-mono text-foreground/70 whitespace-pre-wrap break-words overflow-x-auto'>
{isExpanded ? valueStr : `${valueStr.slice(0, 100)}...`}
                    </pre>
                                  </div>
                                </div>
                              ) : (
                                <pre className='text-[11px] font-mono text-foreground/70 whitespace-pre-wrap break-words overflow-x-auto'>
{valueStr}
                                </pre>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
              </div>
              ) : (
                <div className='flex h-full items-center justify-center'>
                  <p className='text-muted-foreground/60 text-xs'>
                    {scopedVariables && Object.keys(allEnvVars).length > 0
                      ? 'No environment variables referenced in input'
                      : 'No environment variables'}
                  </p>
          </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  )
} 