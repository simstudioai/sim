'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { sleep } from '@sim/utils/helpers'
import type { Edge } from 'reactflow'
import { buildMockExecutionPlan } from '@/lib/academy/mock-execution'
import type {
  ExerciseBlockState,
  ExerciseDefinition,
  ExerciseEdgeState,
  ValidationResult,
} from '@/lib/academy/types'
import { validateExercise } from '@/lib/academy/validation'
import { cn } from '@/lib/core/utils/cn'
import { getEffectiveBlockOutputs } from '@/lib/workflows/blocks/block-outputs'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { GlobalCommandsProvider } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { SandboxWorkspacePermissionsProvider } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import Workflow from '@/app/workspace/[workspaceId]/w/[workflowId]/workflow'
import { getBlock } from '@/blocks/registry'
import { workflowKeys } from '@/hooks/queries/workflows'
import { SandboxBlockConstraintsContext } from '@/hooks/use-sandbox-block-constraints'
import { useExecutionStore } from '@/stores/execution/store'
import { useTerminalConsoleStore } from '@/stores/terminal/console/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { BlockState, SubBlockState, WorkflowState } from '@/stores/workflows/workflow/types'
import { LessonVideo } from './lesson-video'
import { ValidationChecklist } from './validation-checklist'

const logger = createLogger('SandboxCanvasProvider')

const SANDBOX_WORKSPACE_ID = 'sandbox'

interface SandboxCanvasProviderProps {
  /** Unique ID for this exercise instance */
  exerciseId: string
  /** Full exercise configuration */
  exerciseConfig: ExerciseDefinition
  /**
   * Called when all validation rules pass for the first time.
   * Receives the current canvas state so the caller can persist it.
   */
  onComplete?: (blocks: ExerciseBlockState[], edges: ExerciseEdgeState[]) => void
  /** Optional video URL (YouTube/Vimeo) shown above the checklist — used for mixed lessons */
  videoUrl?: string
  /** Optional description shown below the video (or below checklist if no video) */
  description?: string
  className?: string
}

/**
 * Builds a Zustand-compatible WorkflowState from exercise block/edge definitions.
 * Looks up each block type in the registry to construct proper sub-block and output maps.
 */
function buildWorkflowState(
  initialBlocks: ExerciseBlockState[],
  initialEdges: ExerciseEdgeState[]
): WorkflowState {
  const blocks: Record<string, BlockState> = {}

  for (const exerciseBlock of initialBlocks) {
    const config = getBlock(exerciseBlock.type)
    if (!config) {
      logger.warn(`Unknown block type "${exerciseBlock.type}" in exercise config`)
      continue
    }

    const subBlocks: Record<string, SubBlockState> = {}
    for (const sb of config.subBlocks ?? []) {
      const overrideValue = exerciseBlock.subBlocks?.[sb.id]
      subBlocks[sb.id] = {
        id: sb.id,
        type: sb.type,
        value: (overrideValue !== undefined ? overrideValue : null) as SubBlockState['value'],
      }
    }

    const outputs = getEffectiveBlockOutputs(exerciseBlock.type, subBlocks, {
      triggerMode: false,
      preferToolOutputs: true,
    })

    blocks[exerciseBlock.id] = {
      id: exerciseBlock.id,
      type: exerciseBlock.type,
      name: config.name,
      position: exerciseBlock.position,
      subBlocks,
      outputs,
      enabled: true,
      horizontalHandles: true,
      advancedMode: false,
      triggerMode: false,
      height: 0,
      locked: exerciseBlock.locked ?? false,
    }
  }

  const edges: Edge[] = initialEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    type: 'default',
    data: {},
  }))

  return { blocks, edges, loops: {}, parallels: {}, lastSaved: Date.now() }
}

/**
 * Reads the current canvas state from the workflow store and converts it to
 * the exercise block/edge format used by the validation engine.
 */
function readCurrentCanvasState(workflowId: string): {
  blocks: ExerciseBlockState[]
  edges: ExerciseEdgeState[]
} {
  const workflowStore = useWorkflowStore.getState()
  const subBlockStore = useSubBlockStore.getState()

  const blocks: ExerciseBlockState[] = Object.values(workflowStore.blocks).map((block) => {
    const storedValues = subBlockStore.workflowValues[workflowId] ?? {}
    const blockValues = storedValues[block.id] ?? {}
    const subBlocks: Record<string, unknown> = { ...blockValues }
    return {
      id: block.id,
      type: block.type,
      position: block.position,
      subBlocks,
    }
  })

  const edges: ExerciseEdgeState[] = workflowStore.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
  }))

  return { blocks, edges }
}

/**
 * Wraps the real Sim canvas in sandbox mode for Sim Academy exercises.
 *
 * - Pre-hydrates workflow stores directly (no API calls)
 * - Provides sandbox permissions (canEdit: true, no workspace dependency)
 * - Displays a constrained block toolbar and live validation checklist
 * - Supports mock execution to simulate workflow runs
 */
export function SandboxCanvasProvider({
  exerciseId,
  exerciseConfig,
  onComplete,
  videoUrl,
  description,
  className,
}: SandboxCanvasProviderProps) {
  const [isReady, setIsReady] = useState(false)
  const [validationResult, setValidationResult] = useState<ValidationResult>({
    passed: false,
    results: [],
  })
  const [hintIndex, setHintIndex] = useState(-1)
  const completedRef = useRef(false)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete
  const isMockRunningRef = useRef(false)
  const handleMockRunRef = useRef<() => Promise<void>>(async () => {})

  // Stable exercise ID — used as the workflow ID in the stores
  const workflowId = `sandbox-${exerciseId}`

  const runValidation = useCallback(() => {
    const { blocks, edges } = readCurrentCanvasState(workflowId)
    const result = validateExercise(blocks, edges, exerciseConfig.validationRules)

    setValidationResult((prev) => {
      if (
        prev.passed === result.passed &&
        prev.results.length === result.results.length &&
        prev.results.every((r, i) => r.passed === result.results[i].passed)
      ) {
        return prev
      }
      return result
    })

    if (result.passed && !completedRef.current) {
      completedRef.current = true
      onCompleteRef.current?.(blocks, edges)
    }
  }, [workflowId, exerciseConfig.validationRules])

  useEffect(() => {
    completedRef.current = false
    setHintIndex(-1)

    const workflowState = buildWorkflowState(
      exerciseConfig.initialBlocks ?? [],
      exerciseConfig.initialEdges ?? []
    )

    const syntheticMetadata: WorkflowMetadata = {
      id: workflowId,
      name: 'Exercise',
      lastModified: new Date(),
      createdAt: new Date(),
      color: '#3972F6',
      workspaceId: SANDBOX_WORKSPACE_ID,
      sortOrder: 0,
      isSandbox: true,
    }

    useWorkflowStore.getState().replaceWorkflowState(workflowState)
    useSubBlockStore.getState().initializeFromWorkflow(workflowId, workflowState.blocks)

    const qc = getQueryClient()
    const cacheKey = workflowKeys.list(SANDBOX_WORKSPACE_ID, 'active')
    const cached = qc.getQueryData<WorkflowMetadata[]>(cacheKey) ?? []
    qc.setQueryData(cacheKey, [...cached.filter((w) => w.id !== workflowId), syntheticMetadata])

    useWorkflowRegistry.setState({
      activeWorkflowId: workflowId,
      hydration: {
        phase: 'ready',
        workspaceId: SANDBOX_WORKSPACE_ID,
        workflowId,
        requestId: null,
        error: null,
      },
    })

    logger.info('Sandbox stores hydrated', { workflowId })
    setIsReady(true)

    // Coalesce rapid store updates so validation runs at most once per animation frame.
    let rafId: number | null = null
    const scheduleValidation = () => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        runValidation()
      })
    }

    const unsubWorkflow = useWorkflowStore.subscribe(scheduleValidation)
    const unsubSubBlock = useSubBlockStore.subscribe(scheduleValidation)

    // When the panel's Run button is clicked, useWorkflowExecution sets isExecuting=true
    // and returns immediately (no API call). Detect that signal here and run mock execution.
    const unsubExecution = useExecutionStore.subscribe((state) => {
      const isExec = state.workflowExecutions.get(workflowId)?.isExecuting
      if (isExec && !isMockRunningRef.current) {
        void handleMockRunRef.current()
      }
    })

    runValidation()

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      unsubWorkflow()
      unsubSubBlock()
      unsubExecution()
      const cleanupQc = getQueryClient()
      const cleanupKey = workflowKeys.list(SANDBOX_WORKSPACE_ID, 'active')
      const cleanupCached = cleanupQc.getQueryData<WorkflowMetadata[]>(cleanupKey) ?? []
      cleanupQc.setQueryData(
        cleanupKey,
        cleanupCached.filter((w) => w.id !== workflowId)
      )

      useWorkflowRegistry.setState((state) => ({
        activeWorkflowId: state.activeWorkflowId === workflowId ? null : state.activeWorkflowId,
        hydration:
          state.hydration.workflowId === workflowId
            ? { phase: 'idle', workspaceId: null, workflowId: null, requestId: null, error: null }
            : state.hydration,
      }))
      useWorkflowStore.setState({ blocks: {}, edges: [], loops: {}, parallels: {} })
      useSubBlockStore.setState((state) => {
        const { [workflowId]: _removed, ...rest } = state.workflowValues
        return { workflowValues: rest }
      })
    }
  }, [workflowId, exerciseConfig.initialBlocks, exerciseConfig.initialEdges, runValidation])

  const handleMockRun = useCallback(async () => {
    if (isMockRunningRef.current) return
    isMockRunningRef.current = true

    const { setActiveBlocks, setIsExecuting } = useExecutionStore.getState()
    const { blocks, edges } = readCurrentCanvasState(workflowId)
    const result = validateExercise(blocks, edges, exerciseConfig.validationRules)
    setValidationResult(result)
    if (!result.passed) {
      isMockRunningRef.current = false
      setIsExecuting(workflowId, false)
      return
    }

    const plan = buildMockExecutionPlan(blocks, edges, exerciseConfig.mockOutputs ?? {})
    if (plan.length === 0) {
      isMockRunningRef.current = false
      setIsExecuting(workflowId, false)
      return
    }
    const { addConsole, clearWorkflowConsole } = useTerminalConsoleStore.getState()
    const workflowBlocks = useWorkflowStore.getState().blocks

    setIsExecuting(workflowId, true)
    clearWorkflowConsole(workflowId)
    useTerminalConsoleStore.setState({ isOpen: true })

    try {
      for (let i = 0; i < plan.length; i++) {
        const step = plan[i]
        setActiveBlocks(workflowId, new Set([step.blockId]))
        await sleep(step.delay)
        addConsole({
          workflowId,
          blockId: step.blockId,
          blockName: workflowBlocks[step.blockId]?.name ?? step.blockType,
          blockType: step.blockType,
          executionOrder: i,
          output: step.output,
          success: true,
          durationMs: step.delay,
        })
        setActiveBlocks(workflowId, new Set())
      }
    } finally {
      setIsExecuting(workflowId, false)
      isMockRunningRef.current = false
    }
  }, [workflowId, exerciseConfig.validationRules, exerciseConfig.mockOutputs])
  handleMockRunRef.current = handleMockRun

  const handleShowHint = useCallback(() => {
    const hints = exerciseConfig.hints ?? []
    if (hints.length === 0) return
    setHintIndex((i) => Math.min(i + 1, hints.length - 1))
  }, [exerciseConfig.hints])

  const handlePrevHint = useCallback(() => {
    setHintIndex((i) => Math.max(i - 1, 0))
  }, [])

  if (!isReady) {
    return (
      <div className='flex h-full w-full items-center justify-center bg-[#0e0e0e]'>
        <div className='h-5 w-5 animate-spin rounded-full border-2 border-[#ECECEC] border-t-transparent' />
      </div>
    )
  }

  const hints = exerciseConfig.hints ?? []
  const currentHint = hintIndex >= 0 ? hints[hintIndex] : null

  return (
    <SandboxBlockConstraintsContext.Provider value={exerciseConfig.availableBlocks}>
      <GlobalCommandsProvider>
        <SandboxWorkspacePermissionsProvider>
          <div className={cn('flex h-full w-full overflow-hidden', className)}>
            <div className='flex w-56 flex-shrink-0 flex-col gap-3 overflow-y-auto border-[#1F1F1F] border-r bg-[#141414] p-3'>
              {(videoUrl || description) && (
                <div className='flex flex-col gap-2'>
                  {videoUrl && <LessonVideo url={videoUrl} title='Lesson video' />}
                  {description && (
                    <p className='text-[#666] text-[11px] leading-relaxed'>{description}</p>
                  )}
                  <div className='border-[#1F1F1F] border-t' />
                </div>
              )}
              {exerciseConfig.instructions && (
                <p className='text-[#999] text-[11px] leading-relaxed'>
                  {exerciseConfig.instructions}
                </p>
              )}
              <ValidationChecklist
                results={validationResult.results}
                allPassed={validationResult.passed}
              />

              <div className='mt-auto flex flex-col gap-2'>
                {currentHint && (
                  <div className='rounded-[6px] border border-[#2A2A2A] bg-[#1A1A1A] px-3 py-2 text-[11px]'>
                    <div className='mb-1 flex items-center justify-between'>
                      <span className='font-[430] text-[#666]'>
                        Hint {hintIndex + 1}/{hints.length}
                      </span>
                      <div className='flex gap-1'>
                        <button
                          type='button'
                          onClick={handlePrevHint}
                          disabled={hintIndex === 0}
                          className='rounded px-1 text-[#666] transition-colors hover:text-[#ECECEC] disabled:opacity-30'
                          aria-label='Previous hint'
                        >
                          ‹
                        </button>
                        <button
                          type='button'
                          onClick={handleShowHint}
                          disabled={hintIndex === hints.length - 1}
                          className='rounded px-1 text-[#666] transition-colors hover:text-[#ECECEC] disabled:opacity-30'
                          aria-label='Next hint'
                        >
                          ›
                        </button>
                      </div>
                    </div>
                    <span className='text-[#ECECEC]'>{currentHint}</span>
                  </div>
                )}
                {hints.length > 0 && hintIndex < 0 && (
                  <button
                    type='button'
                    onClick={handleShowHint}
                    className='w-full rounded-[5px] border border-[#2A2A2A] bg-[#1A1A1A] px-3 py-1.5 text-[#999] text-[12px] transition-colors hover:border-[#3A3A3A] hover:text-[#ECECEC]'
                  >
                    Show hint
                  </button>
                )}
              </div>
            </div>

            <div className='relative flex-1 overflow-hidden'>
              <Workflow workspaceId={SANDBOX_WORKSPACE_ID} workflowId={workflowId} sandbox />
            </div>
          </div>
        </SandboxWorkspacePermissionsProvider>
      </GlobalCommandsProvider>
    </SandboxBlockConstraintsContext.Provider>
  )
}
