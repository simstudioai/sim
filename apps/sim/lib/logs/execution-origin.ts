import { workflowExecutionLogs } from '@sim/db/schema'
import { type SQL, sql } from 'drizzle-orm'
import type { WorkflowLogSummary } from '@/lib/api/contracts/logs'

export type WorkflowExecutionOrigin = WorkflowLogSummary['executionOrigin']

/** Resolves the origin recorded by the workflow execution producer. */
export function workflowExecutionOriginSql(): SQL<WorkflowExecutionOrigin> {
  return sql<WorkflowExecutionOrigin>`CASE
    WHEN ${workflowExecutionLogs.executionData}->'correlation'->>'source' = 'workflow_group'
    THEN 'workflow_group'
    ELSE NULL
  END`
}
