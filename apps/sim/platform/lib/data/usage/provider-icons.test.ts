/**
 * @vitest-environment node
 *
 * A gap is silent: a usage row for a model provider the map leaves out renders the generic mark
 * where its neighbours show their brand.
 */
import { expect, it } from 'vitest'
import { MODEL_PROVIDER_ICONS } from '@/platform/lib/data/usage/provider-icons'
import { PROVIDER_DEFINITIONS } from '@/providers/models'

it('has a mark for every provider the model registry defines', () => {
  const missing = Object.keys(PROVIDER_DEFINITIONS).filter((id) => !MODEL_PROVIDER_ICONS[id])
  expect(missing).toEqual([])
})
