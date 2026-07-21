import { rmSync } from 'node:fs'
import { sleep } from '@sim/utils/helpers'
import { dropRunDatabase, dropRunDatabaseWithRetries } from '../support/database'
import { parseProcessGroupIds } from '../support/signal-cleanup'

const adminUrl = process.env.E2E_PG_ADMIN_URL
const databaseName = process.env.E2E_DATABASE_NAME
const processGroupIds = parseProcessGroupIds(process.env.E2E_CLEANUP_PROCESS_GROUPS)
const sensitiveDirectories = JSON.parse(process.env.E2E_CLEANUP_DIRECTORIES ?? '[]') as string[]
const databaseCreationComplete = process.env.E2E_DATABASE_CREATION_COMPLETE === 'true'

if (!adminUrl || !databaseName) {
  console.error('Signal cleanup requires E2E_PG_ADMIN_URL and E2E_DATABASE_NAME')
  process.exit(1)
}

const failures: unknown[] = []
signalProcessGroups(processGroupIds, 'SIGTERM', failures)
await sleep(500)

try {
  if (databaseCreationComplete) {
    await dropRunDatabase(adminUrl, databaseName)
  } else {
    await dropRunDatabaseWithRetries(adminUrl, databaseName)
  }
} catch (error) {
  failures.push(error)
}

signalProcessGroups(processGroupIds, 'SIGKILL', failures)
await sleep(250)

for (const directory of sensitiveDirectories) {
  try {
    rmSync(directory, { recursive: true, force: true })
  } catch (error) {
    failures.push(error)
  }
}

for (const error of failures) console.error(error)
process.exit(failures.length > 0 ? 1 : 0)

function signalProcessGroups(
  groupIds: number[],
  signal: NodeJS.Signals,
  failures: unknown[]
): void {
  for (const groupId of groupIds) {
    if (!Number.isInteger(groupId) || groupId <= 0) continue
    try {
      if (process.platform !== 'win32') process.kill(-groupId, signal)
      else process.kill(groupId, signal)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ESRCH') continue
      if (code === 'EPERM' && process.platform !== 'win32') {
        try {
          process.kill(groupId, signal)
        } catch (fallbackError) {
          if ((fallbackError as NodeJS.ErrnoException).code !== 'ESRCH') {
            failures.push(fallbackError)
          }
        }
      } else {
        failures.push(error)
      }
    }
  }
}
