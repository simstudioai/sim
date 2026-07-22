import { accessGateCases, mutationControlCases } from '../authorization/contracts'
import { existingAuthorizationProofs } from './contracts'
import { expect, test } from './credential-test'

test('credential workflows reference stable Step 4 authorization proofs', () => {
  const accessIds = new Set(accessGateCases.map(({ caseId }) => caseId))
  const mutationIds = new Set(mutationControlCases.map(({ caseId }) => caseId))

  expect(new Set(existingAuthorizationProofs.map(({ caseId }) => caseId)).size).toBe(
    existingAuthorizationProofs.length
  )
  for (const proof of existingAuthorizationProofs) {
    expect(proof.kind === 'access' ? accessIds : mutationIds).toContain(proof.caseId)
  }
})
