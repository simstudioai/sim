/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { updateBranchProtectionTool } from '@/tools/github/update_branch_protection'

const BASE = { owner: 'octocat', repo: 'hello-world', branch: 'main', apiKey: 'token' }

function bodyFor(params: Record<string, unknown>): Record<string, unknown> {
  return updateBranchProtectionTool.request.body!(params as never) as Record<string, unknown>
}

/**
 * GitHub's `PUT /repos/{owner}/{repo}/branches/{branch}/protection` lists all
 * four settings in the schema's `required` array, but every one is
 * `nullable: true` — the key must be present, and `null` is how a caller turns
 * that protection off. Sim's `required: true` means "present and not null", so
 * declaring these required makes the documented disabling path unreachable:
 * `validateRequiredParametersAfterMerge` rejects `null` as missing before the
 * request is ever built.
 */
describe('github_update_branch_protection body', () => {
  it('sends every required key even when nothing is configured', () => {
    const body = bodyFor(BASE)

    expect(Object.keys(body).sort()).toEqual(
      [
        'enforce_admins',
        'required_pull_request_reviews',
        'required_status_checks',
        'restrictions',
      ].sort()
    )
  })

  it('disables an unset protection with null rather than dropping the key', () => {
    const body = bodyFor(BASE)

    expect(body.required_status_checks).toBeNull()
    expect(body.required_pull_request_reviews).toBeNull()
    expect(body.restrictions).toBeNull()
    expect(body.enforce_admins).toBeNull()
  })

  /**
   * A cleared `short-input` arrives as `''`, and the handler's JSON coercion
   * only parses non-blank strings, so the blank would reach the body verbatim
   * and GitHub would reject `""` where it expects an object or null.
   */
  it('treats a blank field as disabled rather than sending an empty string', () => {
    const body = bodyFor({ ...BASE, restrictions: '', required_status_checks: '   ' })

    expect(body.restrictions).toBeNull()
    expect(body.required_status_checks).toBeNull()
  })

  it('preserves an explicit null', () => {
    const body = bodyFor({ ...BASE, restrictions: null })

    expect(body.restrictions).toBeNull()
  })

  it('passes configured values through untouched', () => {
    const restrictions = { users: ['octocat'], teams: [] }
    const body = bodyFor({ ...BASE, restrictions, enforce_admins: true })

    expect(body.restrictions).toEqual(restrictions)
    expect(body.enforce_admins).toBe(true)
  })

  it('does not require a value the API accepts as null', () => {
    for (const param of [
      'required_status_checks',
      'enforce_admins',
      'required_pull_request_reviews',
      'restrictions',
    ]) {
      expect(
        updateBranchProtectionTool.params[param].required,
        `${param} must not be required: null is the documented way to disable it`
      ).toBe(false)
    }
  })
})
