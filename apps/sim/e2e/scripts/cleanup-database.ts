import { dropRunDatabase } from '../support/database'

const adminUrl = process.env.E2E_PG_ADMIN_URL
const databaseName = process.env.E2E_DATABASE_NAME

if (!adminUrl || !databaseName) {
  console.error('Synchronous E2E cleanup requires E2E_PG_ADMIN_URL and E2E_DATABASE_NAME')
  process.exit(1)
}

try {
  // A signal may arrive while CREATE DATABASE is still completing. Repeating
  // the forced drop catches that narrow race without weakening name/host guards.
  const deadline = Date.now() + 5_000
  let lastError: unknown
  do {
    try {
      await dropRunDatabase(adminUrl, databaseName)
      lastError = undefined
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  } while (Date.now() < deadline)
  if (lastError) throw lastError
} catch (error) {
  console.error(error)
  process.exit(1)
}
