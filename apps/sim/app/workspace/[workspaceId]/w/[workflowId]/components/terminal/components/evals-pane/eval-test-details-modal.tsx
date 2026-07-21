'use client'

import { type ReactNode, useState } from 'react'
import {
  Badge,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipModalTabs,
  ChipTag,
  Skeleton,
} from '@sim/emcn'
import { formatDuration } from '@sim/utils/formatting'
import type {
  WorkflowEvalCriterionRun,
  WorkflowEvalOutcome,
  WorkflowEvalTest,
  WorkflowEvalTestRun,
} from '@/lib/api/contracts/workflow-evals'
import type { EvalTestSelection } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/components/evals-pane/eval-test-selection'
import { useWorkflowEvalRunTestDefinition } from '@/hooks/queries/evals'
import { useLogByExecutionId } from '@/hooks/queries/logs'

type EvalDetailsTab = 'overview' | 'input' | 'output'
type EvalStatusBadgeVariant = 'green' | 'red' | 'amber' | 'blue' | 'gray'

const EVAL_DETAILS_TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'input', label: 'Input' },
  { value: 'output', label: 'Output' },
] as const

interface EvalTestDetailsModalProps {
  workflowId: string
  workspaceId: string
  selection: EvalTestSelection
  onClose: () => void
}

function formatJson(value: unknown): string {
  const serialized = JSON.stringify(value ?? null, null, 2)
  if (serialized === undefined) throw new Error('Eval detail value is not JSON serializable')
  return serialized
}

function getExpectedResult(test: WorkflowEvalTest): unknown {
  switch (test.evaluator.type) {
    case 'code':
      return {
        outcome: 'The code must return true or { passed: true }',
        passingScore: 10,
        outputSelectors: test.evaluator.outputSelectors ?? [],
        code: test.evaluator.code,
      }
    case 'agent':
      return {
        outcome: 'Confidence-weighted score of at least 8/10',
        warning: 'Confidence-weighted score from 5/10 through 7.99/10',
        model: test.evaluator.model,
        criteria: test.evaluator.criteria,
        outputSelectors: test.evaluator.outputSelectors,
      }
    case 'workflow':
      return {
        outcome: 'Raw judge workflow score of at least 8/10',
        warning: 'Raw judge workflow score from 5/10 through 7.99/10',
        judgeWorkflowId: test.evaluator.workflowId,
        inputMappings: test.evaluator.inputMappings,
        scoreOutput: test.evaluator.scoreOutput,
      }
  }
}

function getResult(testRun: WorkflowEvalTestRun): unknown {
  return {
    phase: testRun.phase,
    outcome: testRun.outcome,
    score: testRun.score,
    reason: testRun.reason,
    criteria: testRun.criteria,
    error: testRun.error,
  }
}

function getEvaluatorLabel(testRun: WorkflowEvalTestRun): string {
  switch (testRun.evaluatorType) {
    case 'code':
      return 'Code'
    case 'agent':
      return 'LLM as judge'
    case 'workflow':
      return 'Workflow as judge'
  }
}

function getOutcomeBadge(outcome: WorkflowEvalOutcome): {
  label: string
  variant: EvalStatusBadgeVariant
} {
  switch (outcome) {
    case 'pass':
      return { label: 'Passed', variant: 'green' }
    case 'warning':
      return { label: 'Warning', variant: 'amber' }
    case 'fail':
      return { label: 'Failed', variant: 'red' }
  }
}

function getTestStatusBadge(testRun: WorkflowEvalTestRun): {
  label: string
  variant: EvalStatusBadgeVariant
} {
  switch (testRun.phase) {
    case 'queued':
      return { label: 'Queued', variant: 'gray' }
    case 'running_subject':
      return { label: 'Running workflow', variant: 'blue' }
    case 'running_evaluator':
      return { label: 'Evaluating', variant: 'blue' }
    case 'completed':
      if (!testRun.outcome) throw new Error('Completed eval test is missing its outcome')
      return getOutcomeBadge(testRun.outcome)
    case 'error':
      return { label: 'Error', variant: 'red' }
  }
}

function getCriterionStatusBadge(criterion: WorkflowEvalCriterionRun): {
  label: string
  variant: EvalStatusBadgeVariant
} {
  switch (criterion.phase) {
    case 'queued':
      return { label: 'Queued', variant: 'gray' }
    case 'running':
      return { label: 'Judging', variant: 'blue' }
    case 'completed':
      if (!criterion.verdict) throw new Error('Completed eval criterion is missing its verdict')
      return getOutcomeBadge(criterion.verdict)
    case 'error':
      return { label: 'Error', variant: 'red' }
  }
}

function formatScore(score: number | null): string {
  return score === null ? '—' : `${score.toFixed(2).replace(/\.00$/, '')}/10`
}

function formatConfidence(confidence: number | null): string {
  return confidence === null ? '—' : `${Math.round(confidence * 100)}%`
}

interface OverviewRowProps {
  label: string
  children: ReactNode
}

function OverviewRow({ label, children }: OverviewRowProps) {
  return (
    <div className='flex min-h-10 items-center justify-between gap-4 px-3 py-2'>
      <span className='flex-shrink-0 font-medium text-[var(--text-tertiary)] text-caption'>
        {label}
      </span>
      <div className='min-w-0 text-right font-medium text-[var(--text-secondary)] text-caption tabular-nums'>
        {children}
      </div>
    </div>
  )
}

interface EvalOverviewProps {
  test: WorkflowEvalTest
  testRun: WorkflowEvalTestRun
  description: string
  executionDuration: number | string | null | undefined
}

function EvalOverview({ test, testRun, description, executionDuration }: EvalOverviewProps) {
  if (test.evaluator.type !== testRun.evaluatorType) {
    throw new Error(
      `Eval test definition uses ${test.evaluator.type}, but its run uses ${testRun.evaluatorType}`
    )
  }
  const status = getTestStatusBadge(testRun)
  const agentEvaluator = test.evaluator.type === 'agent' ? test.evaluator : null
  const formattedExecutionDuration = formatDuration(executionDuration, { precision: 2 }) ?? '—'

  return (
    <>
      <ChipModalField type='custom' title='Run overview'>
        <div className='divide-y divide-[var(--border)] overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface-2)] dark:bg-transparent'>
          <OverviewRow label='Status'>
            <Badge variant={status.variant} size='sm' dot>
              {status.label}
            </Badge>
          </OverviewRow>
          <OverviewRow label='Score'>{formatScore(testRun.score)}</OverviewRow>
          <OverviewRow label='Workflow execution'>{formattedExecutionDuration}</OverviewRow>
          <OverviewRow label='Evaluator'>
            <ChipTag variant='gray'>{getEvaluatorLabel(testRun)}</ChipTag>
          </OverviewRow>
          {agentEvaluator && <OverviewRow label='Model'>{agentEvaluator.model}</OverviewRow>}
        </div>
      </ChipModalField>

      <ChipModalField type='custom' title='What happened'>
        <div className='rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 dark:bg-transparent'>
          <p className='whitespace-pre-wrap text-[var(--text-body)] text-sm leading-5'>
            {description}
          </p>
        </div>
      </ChipModalField>

      {testRun.evaluatorType === 'agent' && agentEvaluator && (
        <ChipModalField type='custom' title='LLM judge results'>
          <div className='divide-y divide-[var(--border)] overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface-2)] dark:bg-transparent'>
            {testRun.criteria.map((criterion) => {
              const definition = agentEvaluator.criteria.find(
                (candidate) => candidate.id === criterion.criterionId
              )
              if (!definition) {
                throw new Error(`Eval criterion ${criterion.criterionId} is missing its definition`)
              }
              const criterionStatus = getCriterionStatusBadge(criterion)
              return (
                <div key={criterion.id} className='flex flex-col gap-2.5 px-3 py-3'>
                  <div className='flex min-w-0 items-center justify-between gap-3'>
                    <span className='min-w-0 truncate font-medium text-[var(--text-body)] text-sm'>
                      {criterion.name}
                    </span>
                    <Badge variant={criterionStatus.variant} size='sm' dot>
                      {criterionStatus.label}
                    </Badge>
                  </div>
                  <p className='text-[var(--text-muted)] text-caption leading-5'>
                    {definition.description}
                  </p>
                  <div className='flex items-center justify-between gap-4'>
                    <span className='text-[var(--text-tertiary)] text-caption'>Confidence</span>
                    <span className='font-medium text-[var(--text-secondary)] text-caption tabular-nums'>
                      {formatConfidence(criterion.confidence)}
                    </span>
                  </div>
                  {criterion.reason && (
                    <p className='border-[var(--border)] border-t pt-2.5 text-[var(--text-secondary)] text-caption leading-5'>
                      {criterion.reason}
                    </p>
                  )}
                  {criterion.error && (
                    <p className='border-[var(--border)] border-t pt-2.5 text-[var(--text-error)] text-caption leading-5'>
                      {criterion.error.message}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </ChipModalField>
      )}

      {test.errorBlockIds.length > 0 && (
        <ChipModalField
          type='copy'
          title='Related blocks'
          value={test.errorBlockIds.join(', ')}
          hint='Blocks focused on the canvas when this test does not pass.'
        />
      )}
    </>
  )
}

function getSelectedBlockOutputs(test: WorkflowEvalTest, blockExecutions: unknown): unknown {
  if (!Array.isArray(blockExecutions)) return []

  const selectedBlockIds = new Set<string>()
  if (test.evaluator.type === 'code' || test.evaluator.type === 'agent') {
    for (const selector of test.evaluator.outputSelectors ?? []) {
      selectedBlockIds.add(selector.blockId)
    }
  } else {
    for (const mapping of test.evaluator.inputMappings) {
      if (mapping.source.type === 'subjectOutput') selectedBlockIds.add(mapping.source.blockId)
    }
  }

  if (selectedBlockIds.size === 0) return []
  const selectedOutputs: Array<{ blockId: string; output: unknown }> = []
  for (const execution of blockExecutions) {
    if (
      typeof execution !== 'object' ||
      execution === null ||
      !('blockId' in execution) ||
      typeof execution.blockId !== 'string' ||
      !selectedBlockIds.has(execution.blockId) ||
      !('outputData' in execution)
    ) {
      continue
    }
    selectedOutputs.push({ blockId: execution.blockId, output: execution.outputData })
  }
  return selectedOutputs
}

export function EvalTestDetailsModal({
  workflowId,
  workspaceId,
  selection,
  onClose,
}: EvalTestDetailsModalProps) {
  const [activeTab, setActiveTab] = useState<EvalDetailsTab>('overview')
  const definitionQuery = useWorkflowEvalRunTestDefinition({
    workflowId,
    suiteId: selection.suiteId,
    runId: selection.runId,
    testId: selection.testRun.testId,
  })
  const executionQuery = useLogByExecutionId(workspaceId, selection.testRun.subjectExecutionId)

  const test = definitionQuery.data?.test
  const executionData = executionQuery.data?.executionData
  const executionDuration = executionData?.totalDuration ?? executionQuery.data?.duration
  const isLoading = definitionQuery.isPending || executionQuery.isPending
  const queryError = definitionQuery.error ?? executionQuery.error

  return (
    <ChipModal
      open
      onOpenChange={(open) => !open && onClose()}
      srTitle='Eval test details'
      size='lg'
    >
      <ChipModalHeader onClose={onClose}>{selection.testRun.name}</ChipModalHeader>
      <ChipModalBody>
        {isLoading ? (
          <div
            className='flex flex-col gap-2 px-2 py-1'
            role='status'
            aria-label='Loading eval test details'
          >
            <Skeleton className='h-4 w-2/3' />
            <Skeleton className='h-20 w-full' />
            <Skeleton className='h-20 w-full' />
          </div>
        ) : queryError ? (
          <ChipModalError>{queryError.message}</ChipModalError>
        ) : !test || !executionData ? (
          <ChipModalError>Eval test details are unavailable.</ChipModalError>
        ) : (
          <>
            <ChipModalTabs
              tabs={EVAL_DETAILS_TABS}
              value={activeTab}
              onChange={(value) => setActiveTab(value as EvalDetailsTab)}
              aria-label='Eval test details sections'
            />

            {activeTab === 'overview' && (
              <EvalOverview
                test={test}
                testRun={selection.testRun}
                description={selection.description}
                executionDuration={executionDuration}
              />
            )}

            {activeTab === 'input' && (
              <>
                <ChipModalField
                  type='textarea'
                  title='Workflow input'
                  value={formatJson(test.input)}
                  viewOnly
                  mono
                  minHeight={140}
                />
                {test.mocks && test.mocks.length > 0 && (
                  <ChipModalField
                    type='textarea'
                    title='Block mocks'
                    value={formatJson(test.mocks)}
                    viewOnly
                    mono
                    minHeight={120}
                  />
                )}
                <ChipModalField
                  type='textarea'
                  title='Evaluation setup'
                  value={formatJson(getExpectedResult(test))}
                  viewOnly
                  mono
                  minHeight={160}
                />
              </>
            )}

            {activeTab === 'output' && (
              <>
                <ChipModalField
                  type='textarea'
                  title='Workflow output'
                  value={formatJson(executionData.finalOutput)}
                  viewOnly
                  mono
                  minHeight={140}
                />
                <ChipModalField
                  type='textarea'
                  title='Selected block outputs'
                  value={formatJson(getSelectedBlockOutputs(test, executionData.blockExecutions))}
                  viewOnly
                  mono
                  minHeight={140}
                  hint='Block outputs selected as evidence for this evaluator.'
                />
                <ChipModalField
                  type='textarea'
                  title='Evaluator result'
                  value={formatJson(getResult(selection.testRun))}
                  viewOnly
                  mono
                  minHeight={140}
                />
              </>
            )}
          </>
        )}
      </ChipModalBody>
      <ChipModalFooter onCancel={onClose} primaryAction={{ label: 'Done', onClick: onClose }} />
    </ChipModal>
  )
}
