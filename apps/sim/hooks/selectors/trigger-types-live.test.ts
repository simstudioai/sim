/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getSelectorDefinition } from '@/hooks/selectors/registry'

/**
 * Exercises the real block and trigger registries rather than a mock: the
 * selector reaches them through a lazy import specifically to avoid an
 * initialization cycle, and a mocked test cannot show that the import resolves
 * or that the registry is populated by the time the dropdown asks for options.
 */
const fetchTriggerTypeOptions = () =>
  getSelectorDefinition('workspace.triggerTypes').fetchList!({
    key: 'workspace.triggerTypes',
    context: {},
  })

describe('workspace.triggerTypes against the real registry', () => {
  it('resolves the lazy import into a populated list of unique labels', async () => {
    const options = await fetchTriggerTypeOptions()

    expect(options.length).toBeGreaterThan(10)
    expect(options.every((option) => option.id.length > 0 && option.label.length > 0)).toBe(true)

    const labels = options.map((option) => option.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('merges the two Sim agent trigger values behind one option', async () => {
    const options = await fetchTriggerTypeOptions()

    expect(options.find((option) => option.label === 'Sim agent')?.id).toBe('copilot,mothership')
    expect(options.find((option) => option.label === 'API')?.id).toBe('api')
  })
})
