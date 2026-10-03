import { readTestDatabaseUrl, readTestRedisUrl } from '@sim/db/testing/test-infrastructure'

/** Refuses to run any integration suite without a disposable local database. */
readTestDatabaseUrl()
readTestRedisUrl()
