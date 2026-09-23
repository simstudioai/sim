import { describe, expect, it } from 'vitest'
import { buildUploadedFileContext } from '@/lib/mothership/chat/upload-context'

describe('uploaded file discovery guidance', () => {
  it.each([
    ['photo.png', 'image/png'],
    ['photo.png', 'application/octet-stream'],
    ['photo.jpeg', 'image/jpeg'],
    ['photo.webp', 'image/webp'],
    ['photo.gif', 'image/gif'],
    ['report.pdf', 'application/pdf'],
    ['photo.png', 'image/png; charset=binary'],
    ['notes.txt', 'text/plain'],
    ['report.md', 'text/markdown'],
    ['payroll.xlsx', 'application/octet-stream'],
    ['clip.mp4', 'video/mp4'],
    ['audio.mp3', 'audio/mpeg'],
    ['drawing.svg', 'image/svg+xml'],
    ['scan.tiff', 'image/tiff'],
    ['photo.heic', 'image/heic'],
    ['unknown.bin', 'application/octet-stream'],
  ])('offers the same read entry point for %s (%s)', (name, mediaType) => {
    const { content } = buildUploadedFileContext(name, mediaType, 10)
    expect(content).toContain(
      `Read it with sim_cli: ${JSON.stringify({ args: ['files', 'read', `uploads/${name}`] })}`
    )
    expect(content).not.toContain('files","view')
    expect(content).not.toContain('sim --output json files read')
    expect(content).toContain('inputs.files[].path to mount it in run_code')
  })

  it('keeps the same encoded reference in read and code guidance', () => {
    const { content } = buildUploadedFileContext('screen shot #1.png', 'image/png', 10)
    expect(content).toContain('"args":["files","read","uploads/screen%20shot%20%231.png"]')
    expect(content).toContain('"uploads/screen%20shot%20%231.png" as inputs.files[].path')
    expect(content).toContain('reference image in generate_image')
  })

  it('retains workflow JSON import guidance', () => {
    const { content } = buildUploadedFileContext('workflow.json', 'application/json', 10)
    expect(content).toContain('"args":["files","read","uploads/workflow.json"]')
    expect(content).toContain('workflows import --workflow')
    expect(content).not.toContain('reference image')
  })

  it('retains archive extraction without suggesting direct reads', () => {
    const { content } = buildUploadedFileContext('bundle.zip', 'application/zip', 10)
    expect(content).toContain('Archive "bundle.zip"')
    expect(content).toContain('unzip it there')
    expect(content).not.toContain('Read it with')
  })
})
