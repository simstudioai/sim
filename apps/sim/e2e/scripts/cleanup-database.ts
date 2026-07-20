import { dropRunDatabase } from '../support/database'

const adminUrl = process.env.E2E_PG_ADMIN_URL
const databaseName = process.env.E2E_DATABASE_NAME

if (!adminUrl || !databaseName) {
  console.error('Synchronous E2E cleanup requires E2E_PG_ADMIN_URL and E2E_DATABASE_NAME')
  process.exit(1)
}

try {
  await dropRunDatabase(adminUrl, databaseName)
} catch (error) {
  console.error(error)
  process.exit(1)
}
