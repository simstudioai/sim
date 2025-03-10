import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { account } from '@/db/schema'

/**
 * Get files from Google Drive
 */
export async function GET(request: NextRequest) {
  try {
    // Get the session
    const session = await getSession()

    // Check if the user is authenticated
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }

    // Get the credential ID from the query params
    const { searchParams } = new URL(request.url)
    const credentialId = searchParams.get('credentialId')
    const mimeType = searchParams.get('mimeType')
    const query = searchParams.get('query') || ''

    if (!credentialId) {
      return NextResponse.json({ error: 'Credential ID is required' }, { status: 400 })
    }

    // Get the credential from the database
    const credentials = await db.select().from(account).where(eq(account.id, credentialId)).limit(1)

    if (!credentials.length) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

    const credential = credentials[0]

    // Check if the credential belongs to the user
    if (credential.userId !== session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Check if the access token is valid
    if (!credential.accessToken) {
      return NextResponse.json({ error: 'No access token available' }, { status: 400 })
    }

    // Build the query parameters for Google Drive API
    let queryParams = 'trashed=false'

    // Add mimeType filter if provided
    if (mimeType) {
      queryParams += `&mimeType='${mimeType}'`
    }

    // Add search query if provided
    if (query) {
      queryParams += `&q=name contains '${query}'`
    }

    // Fetch files from Google Drive
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files?${queryParams}&fields=files(id,name,mimeType,iconLink,webViewLink,thumbnailLink,createdTime,modifiedTime,size,owners)`,
      {
        headers: {
          Authorization: `Bearer ${credential.accessToken}`,
        },
      }
    )

    if (!response.ok) {
      const error = await response.json()
      return NextResponse.json(
        { error: error.error?.message || 'Failed to fetch files from Google Drive' },
        { status: response.status }
      )
    }

    const data = await response.json()

    // Filter for Google Sheets files if mimeType is for spreadsheets
    let files = data.files || []

    if (mimeType === 'application/vnd.google-apps.spreadsheet') {
      files = files.filter(
        (file: any) => file.mimeType === 'application/vnd.google-apps.spreadsheet'
      )
    }

    return NextResponse.json({ files }, { status: 200 })
  } catch (error) {
    console.error('Error fetching files from Google Drive:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
