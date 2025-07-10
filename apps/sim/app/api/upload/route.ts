import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs/promises'
import { randomBytes } from 'crypto'

export const runtime = 'nodejs'

const PUBLIC_DIR = path.join(process.cwd(), 'public', 'static')
const MAX_SIZE = 2 * 1024 * 1024 // 2MB
const ALLOWED_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif']

export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') || ''
  if (!contentType.startsWith('multipart/form-data')) {
    return NextResponse.json({ error: 'Invalid content type' }, { status: 400 })
  }
  const boundary = contentType.split('boundary=')[1]
  if (!boundary) {
    return NextResponse.json({ error: 'No boundary' }, { status: 400 })
  }
  // Parse multipart manually (stream, only support single file field)
  const buffer = Buffer.from(await req.arrayBuffer())
  const parts = buffer.toString('latin1').split(`--${boundary}`)
  let fileBuffer: Buffer | null = null
  let fileName = ''
  let fileType = ''
  for (const part of parts) {
    if (part.includes('Content-Disposition: form-data;') && part.includes('filename="')) {
      const match = part.match(/filename="([^"]+)"/)
      if (match) fileName = match[1]
      const typeMatch = part.match(/Content-Type: ([^\r\n]+)/)
      if (typeMatch) fileType = typeMatch[1]
      if (!fileType.startsWith('image/')) {
        return NextResponse.json({ error: 'Only image uploads allowed' }, { status: 400 })
      }
      const fileData = part.split('\r\n\r\n')[1]
      if (fileData) {
        let clean = fileData.replace(/\r\n--$/, '').replace(/\r\n$/, '')
        fileBuffer = Buffer.from(clean, 'latin1')
      }
    }
  }
  if (!fileBuffer || !fileName) {
    return NextResponse.json({ error: 'No file found' }, { status: 400 })
  }
  if (fileBuffer.length > MAX_SIZE) {
    return NextResponse.json({ error: 'File too large (max 2MB)' }, { status: 400 })
  }
  const ext = path.extname(fileName).toLowerCase() || '.png'
  if (!ALLOWED_EXT.includes(ext)) {
    return NextResponse.json({ error: 'Invalid file extension' }, { status: 400 })
  }
  const unique = randomBytes(8).toString('hex')
  const saveName = `agent_${unique}${ext}`
  const savePath = path.join(PUBLIC_DIR, saveName)
  const publicUrl = `/static/${saveName}`
  await fs.mkdir(PUBLIC_DIR, { recursive: true })
  await fs.writeFile(savePath, fileBuffer)
  return NextResponse.json({ url: publicUrl })
} 