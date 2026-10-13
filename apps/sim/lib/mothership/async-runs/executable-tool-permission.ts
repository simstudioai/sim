import { copilotAsyncToolCalls } from '@sim/db/schema'
import { and, inArray, isNull, or } from 'drizzle-orm'
import { EXECUTABLE_TOOL_PERMISSION_DECISIONS } from '@/lib/mothership/async-runs/lifecycle'

/** Check permission in the claim update so a concurrent decision cannot be bypassed. */
export function executableToolPermission() {
  return or(
    and(
      isNull(copilotAsyncToolCalls.permissionRequestedAt),
      isNull(copilotAsyncToolCalls.permissionDecision)
    ),
    inArray(copilotAsyncToolCalls.permissionDecision, [...EXECUTABLE_TOOL_PERMISSION_DECISIONS])
  )
}
