import { expect, test } from '../../fixtures/persona-test'
import { absoluteE2eUrl, readinessLocator, resolveContractPath } from './contract-resolver'
import { type RouteOutcome, routeCases } from './contracts'

for (const routeCase of routeCases.filter((candidate) => candidate.driver !== 'unauthenticated')) {
  test(`${routeCase.caseId} matches its route outcome`, async ({
    contextForPersona,
    personaManifest,
  }) => {
    const context = await contextForPersona(routeCase.driver.personaKey)
    const page = await context.newPage()
    const inputPath = resolveContractPath(personaManifest, routeCase.pathTemplate, routeCase.driver)
    const outcome: RouteOutcome = routeCase.outcome
    const responseExpectation =
      outcome.kind === 'render' || outcome.kind === 'redirect'
        ? outcome.successfulResponse
        : undefined
    const successfulResponse = responseExpectation
      ? page.waitForResponse((candidate) => {
          const url = new URL(candidate.url())
          return url.pathname === responseExpectation.path && candidate.status() === 200
        })
      : null
    const response = await page.goto(absoluteE2eUrl(inputPath))
    if (successfulResponse) {
      const apiResponse = await successfulResponse
      if (responseExpectation?.expectedJson !== undefined) {
        await expect(apiResponse.json()).resolves.toEqual(responseExpectation.expectedJson)
      }
    }

    switch (outcome.kind) {
      case 'render':
        await expect(page).toHaveURL(absoluteE2eUrl(inputPath))
        await expect(
          page.getByRole('heading', {
            name: outcome.heading,
            level: 1,
            exact: true,
          })
        ).toBeVisible()
        await expect(page.getByText(outcome.description, { exact: true })).toBeVisible()
        if (outcome.readiness) {
          await expect(readinessLocator(page, outcome.readiness)).toBeVisible()
        }
        break
      case 'redirect': {
        const expectedPath = resolveContractPath(
          personaManifest,
          outcome.pathTemplate,
          routeCase.driver
        )
        await expect(page).toHaveURL(absoluteE2eUrl(expectedPath))
        expect(response?.ok(), `${routeCase.caseId} redirect destination response`).toBe(true)
        if (outcome.readiness) {
          const destinationReadiness = readinessLocator(page, outcome.readiness)
          await expect(destinationReadiness).toBeVisible()
          await expect(destinationReadiness).toBeEnabled()
        }
        break
      }
      case 'not-found':
        expect(response?.status(), `${routeCase.caseId} must use the real 404 boundary`).toBe(404)
        break
      case 'organization-unavailable':
        await expect(
          page.getByRole('heading', {
            name: outcome.title,
            level: 1,
            exact: true,
          })
        ).toBeVisible()
        await expect(page).toHaveURL(absoluteE2eUrl(inputPath))
        await expect(
          page.getByRole('complementary', { name: 'Organization settings navigation' })
        ).toHaveCount(outcome.presentation === 'embedded' ? 1 : 0)
        break
    }
  })
}
