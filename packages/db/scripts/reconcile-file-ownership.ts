import { readFile } from 'node:fs/promises'
import { createLogger } from '@sim/logger'
import postgres from 'postgres'

const logger = createLogger('FileOwnershipReconciliation')
const url = process.env.DATABASE_URL
if (!url) throw new Error('Missing DATABASE_URL')
const sql = postgres(url, { max: 1, connect_timeout: 10 })

const migrations = [
  '0313_puzzling_zodiak.sql',
  '0358_workspace_file_content_version_precision.sql',
  '0359_workspace_file_search_chunks.sql',
  '0404_file_entity_ownership.sql',
  '0405_file_folder_version_ownership.sql',
  '0406_file_creator_lifetime.sql',
  '0408_public_share_entity_ownership.sql',
  '0409_file_search_owner_scope.sql',
]

try {
  await sql.begin(async (tx) => {
    for (const migration of migrations) {
      const source = await readFile(new URL(`../migrations/${migration}`, import.meta.url), 'utf8')
      for (const chunk of source.split('--> statement-breakpoint')) {
        const statement = chunk.replace(/^(?:\s|--[^\n]*(?:\n|$))*/, '')
        if (
          !/^(?:CREATE (?:OR REPLACE FUNCTION|(?:CONSTRAINT )?TRIGGER)|DROP (?:TRIGGER|FUNCTION))\b/i.test(
            statement
          )
        )
          continue
        const trigger = /^CREATE (?:CONSTRAINT )?TRIGGER (\w+)[\s\S]*?\bON (\w+)/i.exec(statement)
        if (trigger) await tx.unsafe(`DROP TRIGGER IF EXISTS "${trigger[1]}" ON "${trigger[2]}"`)
        await tx.unsafe(statement)
      }
    }
  })
  logger.info('File ownership functions and triggers reconciled')
} finally {
  await sql.end()
}
