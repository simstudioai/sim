import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'

const logger = createLogger('GoogleDriveUpload')

const GOOGLE_DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3/files'
const GOOGLE_DRIVE_FILES_BASE = 'https://www.googleapis.com/drive/v3/files'

const FINAL_FILE_FIELDS =
  'id,name,mimeType,webViewLink,webContentLink,size,createdTime,modifiedTime,parents'

/** A file as returned by the Drive `files` resource after upload. */
export interface DriveUploadedFile {
  id: string
  name: string
  mimeType: string
  webViewLink?: string
  webContentLink?: string
  size?: string
  createdTime?: string
  modifiedTime?: string
  parents?: string[]
}

export interface UploadBufferToDriveParams {
  accessToken: string
  /** File name to create in Drive. */
  name: string
  /**
   * MIME type Drive should store the file as. May be a Google Workspace type
   * (e.g. `application/vnd.google-apps.spreadsheet`) to request conversion.
   */
  mimeType: string
  /**
   * Content-Type of the bytes being uploaded. Defaults to {@link mimeType}.
   * When this differs from {@link mimeType}, Drive performs a format conversion
   * and the created file's name is re-applied so it survives the conversion.
   */
  uploadMimeType?: string
  buffer: Buffer
  /** Optional parent folder id. When omitted, the file lands in My Drive root. */
  folderId?: string
}

/** Error thrown when the Google Drive API rejects an upload, carrying the HTTP status. */
export class DriveUploadError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'DriveUploadError'
  }
}

/**
 * Build the `multipart/related` request body for a Google Drive upload — a JSON
 * metadata part followed by the base64-encoded file part.
 */
function buildMultipartBody(
  metadata: Record<string, unknown>,
  fileBuffer: Buffer,
  mimeType: string,
  boundary: string
): string {
  return [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${mimeType}`,
    'Content-Transfer-Encoding: base64',
    '',
    fileBuffer.toString('base64'),
    `--${boundary}--`,
  ].join('\r\n')
}

/**
 * Upload a file buffer to Google Drive via a multipart upload and return the
 * created file's metadata. Shared by the Google Drive workflow tool and the
 * workspace Files "Export to Drive" action so the upload path lives in one place.
 */
export async function uploadBufferToDrive(
  params: UploadBufferToDriveParams
): Promise<DriveUploadedFile> {
  const { accessToken, name, mimeType, buffer, folderId } = params
  const uploadMimeType = params.uploadMimeType ?? mimeType

  const metadata: { name: string; mimeType: string; parents?: string[] } = {
    name,
    mimeType,
  }
  if (folderId && folderId.trim() !== '') {
    metadata.parents = [folderId.trim()]
  }

  const boundary = `boundary_${generateShortId(12)}`
  const multipartBody = buildMultipartBody(metadata, buffer, uploadMimeType, boundary)

  const uploadResponse = await fetch(
    `${GOOGLE_DRIVE_UPLOAD_BASE}?uploadType=multipart&supportsAllDrives=true`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': Buffer.byteLength(multipartBody, 'utf-8').toString(),
      },
      body: multipartBody,
    }
  )

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text()
    throw new DriveUploadError(
      `Google Drive API error: ${uploadResponse.statusText || errorText || 'upload failed'}`,
      uploadResponse.status
    )
  }

  const uploaded = (await uploadResponse.json()) as { id: string }
  const fileId = uploaded.id

  // A format conversion can drop the requested name; re-apply it so it persists.
  // This is best-effort — the file is already uploaded — but a failure is logged
  // so a mis-named converted file leaves a diagnostic trace.
  if (uploadMimeType !== mimeType) {
    const patchResponse = await fetch(
      `${GOOGLE_DRIVE_FILES_BASE}/${fileId}?supportsAllDrives=true`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name }),
      }
    )
    if (!patchResponse.ok) {
      logger.warn('Failed to re-apply file name after Drive conversion', {
        fileId,
        status: patchResponse.status,
      })
    }
  }

  const finalResponse = await fetch(
    `${GOOGLE_DRIVE_FILES_BASE}/${fileId}?supportsAllDrives=true&fields=${FINAL_FILE_FIELDS}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )

  if (!finalResponse.ok) {
    const errorText = await finalResponse.text()
    throw new DriveUploadError(
      `Google Drive API error fetching file metadata: ${finalResponse.statusText || errorText || 'unknown error'}`,
      finalResponse.status
    )
  }

  return (await finalResponse.json()) as DriveUploadedFile
}
