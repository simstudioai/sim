/**
 * Script to find and delete spam accounts matching a pattern.
 *
 * Usage:
 *   DATABASE_URL="postgres://..." bun run scripts/ban-spam-accounts.ts [--dry-run] [--pattern @sharebot.net]
 *
 * Options:
 *   --dry-run   List matching accounts without deleting (default behavior)
 *   --execute   Actually delete the accounts
 *   --pattern   Email domain/pattern to match (default: @vapu.xyz)
 */

import postgres from 'postgres'

const args = process.argv.slice(2)
const dryRun = !args.includes('--execute')
const patternFlag = args.indexOf('--pattern')
const pattern = patternFlag !== -1 ? args[patternFlag + 1] : '@vapu.xyz'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required')
  process.exit(1)
}

const sql = postgres(DATABASE_URL, { ssl: 'require' })

async function main() {
  console.log(`\n🔍 Searching for spam accounts matching: *${pattern}`)
  console.log(
    `   Mode: ${dryRun ? 'DRY RUN (use --execute to delete)' : '⚠️  EXECUTE MODE - accounts will be deleted'}\n`
  )

  // Find all matching users
  const spamUsers = await sql`
    SELECT u.id, u.name, u.email, u."created_at"
    FROM "user" u
    WHERE u.email LIKE ${'%' + pattern}
    ORDER BY u."created_at" DESC
  `

  if (spamUsers.length === 0) {
    console.log('No matching accounts found.')
    await sql.end()
    return
  }

  console.log(`Found ${spamUsers.length} matching accounts:\n`)

  const userIds = spamUsers.map((u: { id: string }) => u.id)

  // Fetch workflow/workspace counts for all matching users in one query
  const statRows = await sql`
    SELECT
      u.id,
      COUNT(DISTINCT ws.id) AS workspace_count,
      COUNT(DISTINCT wf.id) AS workflow_count
    FROM "user" u
    LEFT JOIN workspace ws ON ws.owner_id = u.id
    LEFT JOIN workflow wf ON wf.user_id = u.id
    WHERE u.id = ANY(${userIds}::text[])
    GROUP BY u.id
  `
  const statsById = Object.fromEntries(statRows.map((r: { id: string }) => [r.id, r]))

  for (const user of spamUsers) {
    const stats = statsById[user.id] ?? { workspace_count: 0, workflow_count: 0 }
    console.log(`  ${user.email}`)
    console.log(`    ID: ${user.id} | Created: ${user.created_at}`)
    console.log(`    Workspaces: ${stats.workspace_count} | Workflows: ${stats.workflow_count}`)
  }

  if (dryRun) {
    console.log(`\n📋 Dry run complete. ${spamUsers.length} accounts would be deleted.`)
    console.log('   Run with --execute to delete these accounts.')
    await sql.end()
    return
  }

  // Execute deletion
  console.log(`\n⚠️  Deleting ${spamUsers.length} accounts...`)

  // Delete workspaces first to handle the billedAccountUserId no-action FK
  const deletedWorkspaces = await sql`
    DELETE FROM workspace WHERE owner_id = ANY(${userIds}::text[])
  `
  console.log(
    `   Deleted ${deletedWorkspaces.count} workspaces (cascades: workflows, execution logs, etc.)`
  )

  // Now delete the users (cascades: sessions, accounts, credentials, etc.)
  const deletedUsers = await sql`
    DELETE FROM "user" WHERE id = ANY(${userIds}::text[])
  `
  console.log(`   Deleted ${deletedUsers.count} user accounts`)

  console.log(`\n✅ Done. ${deletedUsers.count} spam accounts removed.`)

  await sql.end()
}

main().catch(async (err) => {
  console.error('Error:', err)
  await sql.end()
  process.exit(1)
})
