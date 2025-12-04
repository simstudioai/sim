import { type NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/core/config/env'

const PRESENTATION_API_BASE_URL = env.PRESENTATION_API_BASE_URL
export async function POST(req: NextRequest) {
  try {
    const data = await req.json()
    const { operation, numberOfSlides, tone, verbosity, template, content } = data

    // Validate required parameters
    if (!operation) {
      return NextResponse.json({ error: 'Missing required field: operation' }, { status: 400 })
    }
    if (!numberOfSlides) {
      return NextResponse.json({ error: 'Missing required field: numberOfSlides' }, { status: 400 })
    }
    if (!tone) {
      return NextResponse.json({ error: 'Missing required field: tone' }, { status: 400 })
    }
    if (!verbosity) {
      return NextResponse.json({ error: 'Missing required field: verbosity' }, { status: 400 })
    }

    // Step 1: Generate presentation
    const generatePayload = {
      content: content || '',
      n_slides:
        typeof numberOfSlides === 'string' ? Number.parseInt(numberOfSlides, 10) : numberOfSlides,
      language: 'English',
      template: template || 'position2-test',
      tone: tone,
      verbosity: verbosity,
      include_title_slide: true,
      include_table_of_contents: true,
      web_search: true,
      export_as: 'pptx',
      instructions: '',
      trigger_webhook: false,
    }

    const generateResponse = await fetch(
      `${PRESENTATION_API_BASE_URL}/p2-presenton/api/v1/ppt/presentation/generate`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(generatePayload),
      }
    )

    if (!generateResponse.ok) {
      const errorText = await generateResponse.text()
      let errorData
      try {
        errorData = JSON.parse(errorText)
      } catch {
        errorData = errorText
      }
      return NextResponse.json(errorData, { status: generateResponse.status })
    }

    const generateData = await generateResponse.json()
    const { presentation_id, path: filePath } = generateData

    if (!presentation_id || !filePath) {
      return NextResponse.json(
        {
          error: 'Invalid response from presentation API',
          details: 'Missing presentation_id or path',
        },
        { status: 500 }
      )
    }

    // Step 2: Download the PPTX file if download is requested
    const downloadResponse = await fetch(
      `${PRESENTATION_API_BASE_URL}/p2-presenton/api/v1/ppt/presentation/download-pptx`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          file_path: filePath,
        }),
      }
    )

    if (!downloadResponse.ok) {
      const errorText = await downloadResponse.text()
      let errorData
      try {
        errorData = JSON.parse(errorText)
      } catch {
        errorData = errorText
      }
      return NextResponse.json(errorData, { status: downloadResponse.status })
    }

    // Convert the file to base64
    const fileBuffer = await downloadResponse.arrayBuffer()
    const base64File = Buffer.from(fileBuffer).toString('base64')
    const presentationFile = {
      data: base64File,
      filename: filePath.split('/').pop() || 'presentation.pptx',
      mimetype: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    }

    const responseData = {
      presentationFile: presentationFile,
      presentationId: presentation_id,
      message: `Presentation created successfully with ${numberOfSlides} slides, tone: ${tone}, verbosity: ${verbosity}`,
    }

    return NextResponse.json(responseData, { status: 200 })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to create presentation',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
