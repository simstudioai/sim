import { beforeEach, describe, expect, it, vi } from 'vitest'
import { spotifyCheckSavedTracksTool } from '@/tools/spotify/check_saved_tracks'
import { spotifyRemoveSavedTracksTool } from '@/tools/spotify/remove_saved_tracks'

const ids = Array.from({ length: 45 }, (_, index) => `t${index}`)
const params = { accessToken: 'token', trackIds: ids.join(',') }

function requestedUris(url: string): string[] {
  return (new URL(url).searchParams.get('uris') ?? '').split(',')
}

const mockFetch = vi.fn()

describe('Spotify library tools with more IDs than one /me/library request takes', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
  })

  it('checks all 45 tracks across two /me/library/contains requests, in order', async () => {
    const url = spotifyCheckSavedTracksTool.request.url
    if (typeof url !== 'function') throw new Error('Missing check URL builder')
    expect(requestedUris(url(params))).toEqual(ids.slice(0, 40).map((id) => `spotify:track:${id}`))

    const transform = spotifyCheckSavedTracksTool.transformResponse
    if (!transform) throw new Error('Missing check response handler')
    mockFetch.mockResolvedValueOnce(Response.json([true, false, true, false, true]))
    const result = await transform(Response.json(Array.from({ length: 40 }, () => false)), params)

    expect(requestedUris(String(mockFetch.mock.calls[0][0]))).toEqual(
      ids.slice(40).map((id) => `spotify:track:${id}`)
    )
    expect(result.output.results).toHaveLength(45)
    expect(result.output.results.slice(40)).toEqual(
      ids.slice(40).map((id, index) => ({ id, saved: index % 2 === 0 }))
    )
  })

  it('removes all 45 tracks, sending the last 5 in a second DELETE', async () => {
    const transform = spotifyRemoveSavedTracksTool.transformResponse
    if (!transform) throw new Error('Missing remove response handler')
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))

    const result = await transform(new Response(null, { status: 200 }), params)

    expect(result.success).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ method: 'DELETE' })
    expect(requestedUris(String(mockFetch.mock.calls[0][0]))).toEqual(
      ids.slice(40).map((id) => `spotify:track:${id}`)
    )
  })
})
