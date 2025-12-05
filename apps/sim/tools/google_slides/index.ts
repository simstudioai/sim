import { addImageTool } from '@/tools/google_slides/add_image'
import { addSlideTool } from '@/tools/google_slides/add_slide'
import { createTool } from '@/tools/google_slides/create'
import { getThumbnailTool } from '@/tools/google_slides/get_thumbnail'
import { readTool } from '@/tools/google_slides/read'
import { replaceAllTextTool } from '@/tools/google_slides/replace_all_text'
import { writeTool } from '@/tools/google_slides/write'

export const googleSlidesReadTool = readTool
export const googleSlidesWriteTool = writeTool
export const googleSlidesCreateTool = createTool
export const googleSlidesReplaceAllTextTool = replaceAllTextTool
export const googleSlidesAddSlideTool = addSlideTool
export const googleSlidesGetThumbnailTool = getThumbnailTool
export const googleSlidesAddImageTool = addImageTool
