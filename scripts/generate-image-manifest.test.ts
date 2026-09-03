import { describe, expect, it } from 'vitest'
import { collectImages, renderManifest } from './generate-image-manifest'

describe('collectImages', () => {
  it('finds images across every container key a pod spec can use', () => {
    const images = collectImages([
      {
        kind: 'Deployment',
        spec: {
          template: {
            spec: {
              initContainers: [{ image: 'ghcr.io/simstudioai/migrations:v1' }],
              containers: [{ image: 'ghcr.io/simstudioai/simstudio:v1' }],
              ephemeralContainers: [{ image: 'busybox:1.36' }],
            },
          },
        },
      },
    ])

    expect(images).toEqual([
      'busybox:1.36',
      'ghcr.io/simstudioai/migrations:v1',
      'ghcr.io/simstudioai/simstudio:v1',
    ])
  })

  it('reaches containers nested below a workload wrapper', () => {
    const images = collectImages([
      {
        kind: 'CronJob',
        spec: {
          jobTemplate: {
            spec: { template: { spec: { containers: [{ image: 'curlimages/curl:8.5.0' }] } } },
          },
        },
      },
    ])

    expect(images).toEqual(['curlimages/curl:8.5.0'])
  })

  it('deduplicates the same image pulled by several workloads', () => {
    const container = { containers: [{ image: 'redis:7-alpine' }] }
    const images = collectImages([
      { spec: { template: { spec: container } } },
      { spec: { template: { spec: container } } },
    ])

    expect(images).toEqual(['redis:7-alpine'])
  })

  it('ignores an image field that is not a container image', () => {
    const images = collectImages([{ metadata: { annotations: { image: 'not-a-container' } } }])

    expect(images).toEqual([])
  })

  it('skips a container whose image is absent or empty', () => {
    const images = collectImages([
      { spec: { containers: [{ name: 'no-image' }, { image: '' }, { image: 'busybox:1.36' }] } },
    ])

    expect(images).toEqual(['busybox:1.36'])
  })

  it('tolerates null entries rather than throwing on a sparse render', () => {
    const images = collectImages([null, { spec: { containers: [null, { image: 'redis:7' }] } }])

    expect(images).toEqual(['redis:7'])
  })
})

describe('renderManifest', () => {
  it('renders the app version and a sorted image list', () => {
    const manifest = renderManifest({
      appVersion: 'v0.8.18',
      images: ['busybox:1.36', 'redis:7-alpine'],
    })

    expect(manifest).toContain('appVersion: v0.8.18')
    expect(manifest).toContain('  - busybox:1.36\n  - redis:7-alpine\n')
  })

  it('omits the chart version so a chart-only bump does not fail the check', () => {
    const manifest = renderManifest({ appVersion: 'v1', images: ['a:1'] })

    expect(manifest).not.toContain('chartVersion')
  })

  it('ends with a trailing newline so the checked-in file is POSIX-clean', () => {
    const manifest = renderManifest({ appVersion: 'v1', images: ['a:1'] })

    expect(manifest.endsWith('\n')).toBe(true)
    expect(manifest.endsWith('\n\n')).toBe(false)
  })
})
