import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  v1CreateTableRowContract,
  v1UpdateRowsByFilterContract,
  v1UpdateTableRowContract,
  v1UpsertTableRowContract,
} from '@/lib/api/contracts/v1/tables'
import { PRIVATE_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'

describe('v1 public table row contracts', () => {
  it('never expose private secret provenance', () => {
    for (const contract of [
      v1CreateTableRowContract,
      v1UpdateRowsByFilterContract,
      v1UpdateTableRowContract,
      v1UpsertTableRowContract,
    ]) {
      expect(
        JSON.stringify(z.toJSONSchema(contract.body, { unrepresentable: 'any' }))
      ).not.toContain(PRIVATE_SECRET_PROVENANCE_FIELD)
    }
  })
})
