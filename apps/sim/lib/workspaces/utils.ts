import { db } from '@sim/db'
import { workspace as workspaceTable } from '@sim/db/schema'
import { eq } from 'drizzle-orm'

interface WorkspaceBillingSettings {
  billedAccountUserId: string | null
  allowPersonalApiKeys: boolean
}

export async function getWorkspaceBillingSettings(
  workspaceId: string
): Promise<WorkspaceBillingSettings | null> {
  if (!workspaceId) {
    return null
  }

  const rows = await db
    .select({
      billedAccountUserId: workspaceTable.billedAccountUserId,
      allowPersonalApiKeys: workspaceTable.allowPersonalApiKeys,
    })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1)

  if (!rows.length) {
    return null
  }

  return {
    billedAccountUserId: rows[0].billedAccountUserId ?? null,
    allowPersonalApiKeys: rows[0].allowPersonalApiKeys ?? false,
  }
}

export async function getWorkspaceBilledAccountUserId(workspaceId: string): Promise<string | null> {
  const settings = await getWorkspaceBillingSettings(workspaceId)
  return settings?.billedAccountUserId ?? null
}
