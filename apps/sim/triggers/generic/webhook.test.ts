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
  it('declares the request metadata so it can be referenced from later blocks', () => {
    expect(Object.keys(genericWebhookTrigger.outputs)).toEqual(['method', 'query', 'headers'])
    expect(genericWebhookTrigger.outputs.method.type).toBe('string')
    expect(genericWebhookTrigger.outputs.query.type).toBe('object')
    expect(genericWebhookTrigger.outputs.headers.type).toBe('object')
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

  it('names every reserved key the input can carry', () => {
    const instructions = setupInstructions()

    for (const key of Object.keys(genericWebhookTrigger.outputs)) {
      expect(instructions).toContain(`"${key}"`)
    }
  })

  it('names the switch that exposes headers rather than promising them', () => {
    expect(setupInstructions()).toContain('"Expose Request Headers"')
  })

  /**
   * Two of the three outputs only exist once a switch is on, so they are conditioned on it: the
   * reference dropdown must not offer a field the running webhook will not send.
   */
  it.each([
    ['method', 'acceptOtherMethods'],
    ['headers', 'exposeRequestHeaders'],
  ])('gates the %s output on the switch that produces it', (key, field) => {
    expect(genericWebhookTrigger.outputs[key].condition).toEqual({
      field,
      value: [true, 'true'],
    })
  })

  /**
   * Query parameters are the one key that is not opt-in, so offering them unconditionally is
   * correct — gating them on a switch that does not exist would hide them entirely.
   */
  it('offers query unconditionally', () => {
    expect(genericWebhookTrigger.outputs.query.condition).toBeUndefined()
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
