/**
 * Moves every Sim Chat conversation owned by an organization's workspace to that organization,
 * so the chat can act in any of the organization's workspaces the user may access. Chats of a
 * personal workspace (no organization) keep their workspace owner, as do workflow-panel chats,
 * which the schema forbids from having an organization.
 *
 * Run by hand, not as an automatic migration: the workspace sidebar still lists chats by their
 * workspace owner, so this must wait until it lists organization chats. It records each chat's
 * projects first, so moving the owner loses nothing about where the chat worked.
 *
 * Usage: bun --env-file=.env run ./scripts/move-workspace-chats-to-organizations.ts [--dry-run]
 */
import { createLogger } from '@sim/logger'
import postgres from 'postgres'
import { backfillChatProjects } from '../script-migrations/0030_backfill_projects'

const logger = createLogger('MoveWorkspaceChatsToOrganizations')
const BATCH_SIZE = 500

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')
  const dryRun = process.argv.includes('--dry-run')
  const sql = postgres(url, { max: 1 })
  try {
    const [{ count }] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM copilot_chats c JOIN workspace w ON w.id = c.workspace_id
      WHERE c.type = 'mothership' AND c.workflow_id IS NULL AND w.organization_id IS NOT NULL
    `
    logger.info('Workspace chats to move to their organization', { count, dryRun })
    if (dryRun) return

    const chatProjects = await backfillChatProjects(sql)
    logger.info('Recorded chat projects before moving owners', { chatProjects })

    let moved = 0
    for (;;) {
      const result = await sql`
        UPDATE copilot_chats c
        SET organization_id = w.organization_id, workspace_id = NULL
        FROM workspace w
        WHERE c.id IN (
          SELECT c2.id FROM copilot_chats c2 JOIN workspace w2 ON w2.id = c2.workspace_id
          WHERE c2.type = 'mothership' AND c2.workflow_id IS NULL AND w2.organization_id IS NOT NULL
          ORDER BY c2.id LIMIT ${BATCH_SIZE}
        )
          AND w.id = c.workspace_id
      `
      if (result.count === 0) break
      moved += result.count
    }
    logger.info('Moved workspace chats to organizations', { moved })
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  logger.error('Moving workspace chats to organizations failed', { error })
  process.exit(1)
})
