import { projectBackfillDatabaseId } from '@sim/db/maintenance/project-backfill'
import { describe, expect, it } from 'vitest'

describe('Project manifest database binding', () => {
  it('distinguishes socket routing and query overrides without binding credentials', () => {
    expect(projectBackfillDatabaseId('postgres:///prod?host=/var/run/postgresql')).not.toBe(
      projectBackfillDatabaseId('postgres:///prod?host=/tmp/other')
    )
    expect(projectBackfillDatabaseId('postgres://localhost/prod?port=5433')).not.toBe(
      projectBackfillDatabaseId('postgres://localhost/prod?port=5434')
    )
    expect(projectBackfillDatabaseId('postgres://alice:one@localhost/prod')).toBe(
      projectBackfillDatabaseId('postgres://bob:two@localhost:5432/prod')
    )
  })
})
