export const GOOGLE_WORKSPACE_MIME_TYPES = [
  'application/vnd.google-apps.document', // Google Docs
  'application/vnd.google-apps.spreadsheet', // Google Sheets
  'application/vnd.google-apps.presentation', // Google Slides
  'application/vnd.google-apps.drawing', // Google Drawings
  'application/vnd.google-apps.form', // Google Forms
  'application/vnd.google-apps.script', // Google Apps Scripts
]

export const DEFAULT_EXPORT_FORMATS: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
  'application/vnd.google-apps.drawing': 'image/png',
  'application/vnd.google-apps.form': 'application/pdf',
  'application/vnd.google-apps.script': 'application/json',
}

export const SOURCE_MIME_TYPES: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'application/vnd.ms-powerpoint',
}
