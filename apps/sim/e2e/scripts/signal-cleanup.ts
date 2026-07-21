import { rmSync } from 'node:fs'
import { sleep } from '@sim/utils/helpers'
import { dropRunDatabaseWithRetries } from '../support/database'

const adminUrl = process.env.E2E_PG_ADMIN_URL
const databaseName = process.env.E2E_DATABASE_NAME
const processGroupIds = (process.env.E2E_CLEANUP_PROCESS_GROUPS ?? '')
  .split(',')
  .map(Number)
  .filter(Number.isInteger)
const sensitiveDirectories = JSON.parse(process.env.E2E_CLEANUP_DIRECTORIES ?? '[]') as string[]

if (!adminUrl || !databaseName) {
  console.error('Signal cleanup requires E2E_PG_ADMIN_URL and E2E_DATABASE_NAME')
  process.exit(1)
}

const failures: unknown[] = []
signalProcessGroups(processGroupIds, 'SIGTERM', failures)
await sleep(500)

try {
  await dropRunDatabaseWithRetries(adminUrl, databaseName)
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
