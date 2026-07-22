import { accessGateCases } from '../authorization/contracts'
import { SETTINGS_PERSONA_KEYS } from '../personas'
import { dynamicRestrictionCases, peopleWorkflowCases, workflowPersonaKeys } from './contracts'
import { expect, test } from './workflow-test'

test('workflow contracts reference durable personas and authorization proofs', () => {
  const personaKeys = new Set<string>(SETTINGS_PERSONA_KEYS)
  const accessCaseIds = new Set(accessGateCases.map(({ caseId }) => caseId))

  expect(new Set(peopleWorkflowCases.map(({ caseId }) => caseId)).size).toBe(
    peopleWorkflowCases.length
  )
  expect(new Set(dynamicRestrictionCases.map(({ sectionId }) => sectionId)).size).toBe(
    dynamicRestrictionCases.length
  )
  for (const personaKey of workflowPersonaKeys) expect(personaKeys).toContain(personaKey)
  for (const restriction of dynamicRestrictionCases) {
    expect(accessCaseIds).toContain(restriction.existingProofId)
  }
})
