"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
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

export function DebugPanel() {
  const { isDebugging, pendingBlocks, debugContext, activeBlockIds, setActiveBlocks, setPanelFocusedBlockId, panelFocusedBlockId } = useExecutionStore()
  const { activeWorkflowId, workflows } = useWorkflowRegistry()
  const { handleStepDebug, handleResumeDebug, handleCancelDebug, handleRunWorkflow } = useWorkflowExecution()
  const currentWorkflow = useCurrentWorkflow()

  const [chatMessage, setChatMessage] = useState('')
  const hasStartedRef = useRef(false)
  const lastFocusedIdRef = useRef<string | null>(null)

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

  const isFocusedExecuted = debugContext ? !!debugContext?.blockStates.get(focusedBlockId || '')?.executed : false
  const isStarterFocused = focusedBlock?.metadata?.id === 'starter' || focusedBlock?.type === 'starter'
  const isFocusedPending = pendingBlocks.includes(focusedBlockId || '')

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
  }, [focusedBlock, focusedBlockId, debugContext?.blockStates])

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
  }, [focusedBlockId, currentWorkflow.edges, starterId, blockById, debugContext?.blockStates])

  // Reset hasStartedRef when debug mode is deactivated
  useEffect(() => {
    if (!isDebugging) {
      hasStartedRef.current = false
      setPanelFocusedBlockId(null)
    }
  }, [isDebugging, setPanelFocusedBlockId])

  if (!isDebugging) {
    return (
      <div className='flex h-full items-center justify-center text-muted-foreground text-sm'>
        Debug inactive
      </div>
    )
  }

  // Step handler: handles both initial and subsequent steps
  const handleStep = async () => {
    if (!hasStartedRef.current && !debugContext) {
      // First step: initialize the executor which will execute the Start block
      // and return the next blocks as pending
      hasStartedRef.current = true // Set this first to prevent re-entry
      
      if (isChatMode) {
        const text = chatMessage.trim()
        if (!text) {
          hasStartedRef.current = false // Reset if no input
          return
        }
        // Initialize with chat input - this will execute Start and return next blocks
        await handleRunWorkflow({ input: text, conversationId: crypto.randomUUID() }, true)
      } else {
        // Initialize without input - this will execute Start and return next blocks
        await handleRunWorkflow(undefined, true)
      }
      // The Start block has been executed and next blocks are now pending
      return
    }

    // All subsequent steps - execute the pending blocks
    await handleStepDebug()
  }

  return (
    <div className='flex h-full flex-col gap-3 pt-2 pl-[1px]'>
      {/* Header with block title and status */}
      <div className='flex items-center justify-between'>
        <div className='min-w-0 truncate font-medium text-sm'>
          {getDisplayName(focusedBlock) || '—'}
        </div>
        <div className='flex items-center gap-2'>
          <Badge variant='outline' className='text-[10px]'>
            {focusedBlock?.type}
          </Badge>
          <Badge variant='secondary' className='text-[10px]'>
            {isFocusedPending ? 'Current' : isFocusedExecuted ? 'Executed' : 'Not in execution path'}
          </Badge>
        </div>
      </div>

      {/* Inline debug controls + chat input for chat-mode before first step */}
      <div className='flex items-center gap-2'>
        {isChatMode && !hasStartedRef.current && (
          <div className='flex flex-1 items-center gap-2'>
            <Textarea
              placeholder='Workflow input (message)'
              value={chatMessage}
              onChange={(e) => setChatMessage(e.target.value)}
            />
          </div>
        )}
        <Button size='sm' className='h-8' onClick={handleStep}>
          Step
        </Button>
        <Button size='sm' className='h-8' onClick={handleResumeDebug} disabled={!hasStartedRef.current || pendingBlocks.length === 0}>
          Resume
        </Button>
        <Button size='sm' variant='outline' className='h-8' onClick={handleCancelDebug}>
          Cancel
        </Button>
      </div>

      {/* Top half: Input/Output */}
      <div className='grid min-h-0 flex-1 grid-rows-2 gap-3'>
        <section className='min-h-0 rounded-[10px] border p-3'>
          <div className='mb-1 font-medium text-sm text-muted-foreground'>Input</div>
          {Object.keys(visibleSubblockValues).length > 0 ? (
            <ScrollArea className='h-full rounded border'>
              <pre className='p-2 text-[11px]'>
{JSON.stringify(visibleSubblockValues, null, 2)}
              </pre>
            </ScrollArea>
          ) : (
            <div className='text-muted-foreground text-xs'>No inputs available</div>
          )}
        </section>

        <section className='min-h-0 rounded-[10px] border p-3'>
          <div className='mb-1 font-medium text-sm text-muted-foreground'>Output</div>
          {resolvedOutputKVs && Object.keys(resolvedOutputKVs).length > 0 ? (
            <ScrollArea className='h-full rounded border'>
              <pre className='p-2 text-[11px]'>
{JSON.stringify(resolvedOutputKVs, null, 2)}
              </pre>
            </ScrollArea>
          ) : (
            <div className='text-muted-foreground text-xs'>No outputs</div>
          )}
        </section>
      </div>

      {/* Variables: three collapsible subsections */}
      <div className='space-y-2'>
        <details className='rounded-[10px] border p-3'>
          <summary className='cursor-pointer list-none font-medium text-sm'>Output variables</summary>
          <div className='mt-2'>
            {outputVariableEntries.length > 0 ? (
              <ScrollArea className='h-32 rounded border'>
                <div className='divide-y'>
                  {outputVariableEntries.map(({ ref, value }) => (
                    <div key={ref} className='px-2 py-1.5'>
                      <div className='mb-1 font-mono text-[11px] text-muted-foreground'>{ref}</div>
                      <pre className='m-0 whitespace-pre-wrap break-words text-[11px]'>
{JSON.stringify(value, null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <div className='text-muted-foreground text-xs'>None</div>
            )}
          </div>
        </details>

        <details className='rounded-[10px] border p-3'>
          <summary className='cursor-pointer list-none font-medium text-sm'>Workflow variables</summary>
          <div className='mt-2'>
            {workflowVars && Object.keys(workflowVars).length > 0 ? (
              <ScrollArea className='h-24 rounded border'>
                <pre className='p-2 text-[11px]'>
{JSON.stringify(workflowVars, null, 2)}
                </pre>
              </ScrollArea>
            ) : (
              <div className='text-muted-foreground text-xs'>None</div>
            )}
          </div>
        </details>

        <details className='rounded-[10px] border p-3'>
          <summary className='cursor-pointer list-none font-medium text-sm'>Environment variables</summary>
          <div className='mt-2'>
            {envVars && Object.keys(envVars).length > 0 ? (
              <ScrollArea className='h-24 rounded border'>
                <pre className='p-2 text-[11px]'>
{JSON.stringify(envVars, null, 2)}
                </pre>
              </ScrollArea>
            ) : (
              <div className='text-muted-foreground text-xs'>None</div>
            )}
          </div>
        </details>
      </div>
    </div>
  )
} 