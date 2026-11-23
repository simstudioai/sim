import { beforeEach, describe, expect, it, vi } from 'vitest'
import { spotifyCheckSavedTracksTool } from '@/tools/spotify/check_saved_tracks'
import { spotifyFollowArtistsTool } from '@/tools/spotify/follow_artists'
import { spotifyFollowPlaylistTool } from '@/tools/spotify/follow_playlist'
import { spotifyRemoveSavedTracksTool } from '@/tools/spotify/remove_saved_tracks'
import { spotifyUnfollowArtistsTool } from '@/tools/spotify/unfollow_artists'

const ids = Array.from({ length: 45 }, (_, index) => `t${index}`)
const params = { accessToken: 'token', trackIds: ids.join(',') }

function requestedUris(url: string): string[] {
  return (new URL(url).searchParams.get('uris') ?? '').split(',')
}

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

describe('Spotify library tools with more IDs than one /me/library request takes', () => {
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

  it('rejects a first /contains response that is not an array, like the later chunks do', async () => {
    const transform = spotifyCheckSavedTracksTool.transformResponse
    if (!transform) throw new Error('Missing check response handler')
    await expect(
      transform(Response.json({ error: 'unexpected' }), { accessToken: 'token', trackIds: 't0' })
    ).rejects.toThrow('Spotify returned an invalid library check response')
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

describe('Spotify follow tools keep the /me/following and /playlists endpoints', () => {
  it('follows and unfollows up to 50 artists in one /me/following request', async () => {
    const artistIds = Array.from({ length: 55 }, (_, index) => `a${index}`)
    for (const tool of [spotifyFollowArtistsTool, spotifyUnfollowArtistsTool]) {
      const url = tool.request.url
      if (typeof url !== 'function') throw new Error('Missing artist follow URL builder')
      const params = { accessToken: 'token', artistIds: artistIds.join(',') }
      expect(url(params)).toBe(
        `https://api.spotify.com/v1/me/following?type=artist&ids=${artistIds.slice(0, 50).join(',')}`
      )
      await tool.transformResponse?.(new Response(null, { status: 204 }), params)
    }
    expect(spotifyFollowArtistsTool.request.method).toBe('PUT')
    expect(spotifyUnfollowArtistsTool.request.method).toBe('DELETE')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('follows a playlist through /playlists/{id}/followers with its public flag', () => {
    const { url, body } = spotifyFollowPlaylistTool.request
    if (typeof url !== 'function' || !body) throw new Error('Missing playlist follow request')
    const params = (value: unknown) =>
      ({ accessToken: 'token', playlistId: 'p1', public: value }) as Parameters<typeof url>[0]
    expect(url(params(false))).toBe('https://api.spotify.com/v1/playlists/p1/followers')
    expect(body(params(true))).toEqual({ public: true })
    expect(body(params(null))).toEqual({ public: true })
    expect(body(params(undefined))).toEqual({ public: true })
    expect(body(params(false))).toEqual({ public: false })
  })
})
