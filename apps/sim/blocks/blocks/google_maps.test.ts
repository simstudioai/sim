import { describe, expect, it } from 'vitest'
import { GoogleMapsBlock } from '@/blocks/blocks/google_maps'

/**
 * On an agent tool call the model supplies args under the tool's own param names (`lat`, `lng`,
 * `address`, arrays for JSON params), not the block's dedicated fields.
 */
describe('GoogleMapsBlock agent tool calls', () => {
  it.each([
    ['reverse_geocode', { lat: 40.7128, lng: -74.006 }],
    ['validate_address', { address: '1600 Amphitheatre Pkwy', regionCode: 'US' }],
    ['distance_matrix', { origin: 'Boston', destinations: ['New York', 'Albany'] }],
    ['places_nearby', { lat: 1, lng: 2, radius: 500, includedTypes: ['cafe'] }],
    ['speed_limits', { placeIds: ['place-1'], units: 'MPH' }],
  ])('keeps the model args on %s', (operation, inputs) => {
    const mapped = GoogleMapsBlock.tools.config?.params?.(inputs, { operation })
    expect({ ...inputs, ...mapped }).toMatchObject(inputs)
  })
})
