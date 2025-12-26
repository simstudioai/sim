import { createLogger } from '@sim/logger'
import { toPng } from 'html-to-image'

const logger = createLogger('OGCapturePreview')

/**
 * OG image dimensions following social media best practices
 */
export const OG_IMAGE_WIDTH = 1200
export const OG_IMAGE_HEIGHT = 630

/**
 * Capture a workflow preview element as a PNG image for OpenGraph.
 * Returns a base64-encoded data URL.
 *
 * @param element - The DOM element containing the workflow preview
 * @param retries - Number of retry attempts (default: 3)
 * @returns Base64 data URL of the captured image, or null if capture fails
 */
export async function captureWorkflowPreview(
  element: HTMLElement,
  retries = 3
): Promise<string | null> {
  if (!element || element.children.length === 0) {
    logger.warn('Cannot capture empty element')
    return null
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      logger.info(`Capturing workflow preview for OG image (attempt ${attempt}/${retries})`)

      const dataUrl = await toPng(element, {
        width: OG_IMAGE_WIDTH,
        height: OG_IMAGE_HEIGHT,
        pixelRatio: 2, // Higher quality for crisp rendering
        backgroundColor: '#0c0c0c', // Dark background matching the app theme
        style: {
          transform: 'scale(1)',
          transformOrigin: 'top left',
        },
        filter: (node) => {
          const className = node.className?.toString() || ''
          if (
            className.includes('tooltip') ||
            className.includes('popover') ||
            className.includes('overlay') ||
            className.includes('react-flow__controls') ||
            className.includes('react-flow__minimap')
          ) {
            return false
          }
          return true
        },
      })

      if (dataUrl && dataUrl.length > 1000) {
        logger.info('Workflow preview captured successfully')
        return dataUrl
      }

      logger.warn(`Captured image appears to be empty (attempt ${attempt})`)
    } catch (error) {
      logger.error(`Failed to capture workflow preview (attempt ${attempt}):`, error)
    }

    if (attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt))
    }
  }

  logger.error('All capture attempts failed')
  return null
}

/**
 * Upload a captured OG image to the server.
 *
 * @param templateId - The ID of the template to associate the image with
 * @param imageData - Base64-encoded image data URL
 * @returns The public URL of the uploaded image, or null if upload fails
 */
export async function uploadOGImage(templateId: string, imageData: string): Promise<string | null> {
  try {
    logger.info(`Uploading OG image for template: ${templateId}`)

    const response = await fetch(`/api/templates/${templateId}/og-image`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ imageData }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.error || `Upload failed with status ${response.status}`)
    }

    const data = await response.json()
    logger.info(`OG image uploaded successfully: ${data.ogImageUrl}`)

    return data.ogImageUrl
  } catch (error) {
    logger.error('Failed to upload OG image:', error)
    return null
  }
}

/**
 * Capture and upload a workflow preview as an OG image.
 * This is a convenience function that combines capture and upload.
 *
 * @param element - The DOM element containing the workflow preview
 * @param templateId - The ID of the template
 * @returns The public URL of the uploaded image, or null if either step fails
 */
export async function captureAndUploadOGImage(
  element: HTMLElement,
  templateId: string
): Promise<string | null> {
  const imageData = await captureWorkflowPreview(element)

  if (!imageData) {
    logger.warn('Skipping OG image upload - capture failed')
    return null
  }

  return uploadOGImage(templateId, imageData)
}
