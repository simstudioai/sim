/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { genericWebhookTrigger } from '@/triggers/generic/webhook'

function subBlock(id: string) {
  return genericWebhookTrigger.subBlocks.find((entry) => entry.id === id)
}

function setupInstructions(): string {
  return String(subBlock('triggerInstructions')?.defaultValue)
}

describe('genericWebhookTrigger', () => {
  /**
   * Declaring outputs here does not add editor completions — the executor reads the same list as
   * an exhaustive schema and rejects every field outside it. See
   * `executor/utils/block-data.test.ts` for the behavior this protects.
   */
  it('declares no outputs, because the caller decides the payload shape', () => {
    expect(genericWebhookTrigger.outputs).toEqual({})
  })

  /**
   * The default is the compatibility contract: an existing webhook has neither key in its
   * `providerConfig`, and a newly created one must start in the same state rather than silently
   * opting every new webhook into replayable GET deliveries and headers in execution logs.
   */
  it.each(['acceptOtherMethods', 'exposeRequestHeaders'])('ships %s off by default', (id) => {
    const field = subBlock(id)

    expect(field?.type).toBe('switch')
    expect(field?.defaultValue).toBe(false)
  })

  it('describes POST as the accepted method and names the switch that widens it', () => {
    const instructions = setupInstructions()

    expect(instructions).toContain('The webhook accepts POST.')
    expect(instructions).toContain('"Accept Other HTTP Methods"')
    expect(instructions).toContain('GET, PUT, PATCH and DELETE')
  })

  /**
   * Named explicitly rather than derived from `outputs`, which is intentionally empty — deriving
   * it would make this assertion vacuous.
   */
  it.each(['method', 'query', 'headers'])(
    'names the reserved "%s" key the input can carry',
    (key) => {
      expect(setupInstructions()).toContain(`"${key}"`)
    }
  )

  it('names the switch that exposes headers rather than promising them', () => {
    expect(setupInstructions()).toContain('"Expose Request Headers"')
  })

  /**
   * Auth is header-based, so a plain link cannot carry it. Saying so is the difference between a
   * user disabling auth knowingly and discovering it after publishing an open trigger URL.
   */
  it('warns that authentication cannot be used with a plain link', () => {
    expect(setupInstructions()).toContain('cannot be used with a plain link')
  })

  /**
   * The switch accepts four named methods, not every method — HEAD and OPTIONS still answer 405.
   * A title claiming "all" would be the same kind of overstatement this trigger exists to remove.
   */
  it('does not claim to accept methods it rejects', () => {
    const field = subBlock('acceptOtherMethods')

    expect(field?.title).not.toContain('All')
    expect(field?.description).toContain('GET, PUT, PATCH and DELETE')
  })
})
