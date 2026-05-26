import { addImageTool } from '@/tools/google_slides/add_image'
import { addSlideTool } from '@/tools/google_slides/add_slide'
import { batchUpdateTool } from '@/tools/google_slides/batch_update'
import { copyPresentationTool } from '@/tools/google_slides/copy_presentation'
import { createTool } from '@/tools/google_slides/create'
import { createLineTool } from '@/tools/google_slides/create_line'
import { createParagraphBulletsTool } from '@/tools/google_slides/create_paragraph_bullets'
import { createShapeTool } from '@/tools/google_slides/create_shape'
import { createSheetsChartTool } from '@/tools/google_slides/create_sheets_chart'
import { createTableTool } from '@/tools/google_slides/create_table'
import { createVideoTool } from '@/tools/google_slides/create_video'
import { deleteObjectTool } from '@/tools/google_slides/delete_object'
import { deleteParagraphBulletsTool } from '@/tools/google_slides/delete_paragraph_bullets'
import { deleteTableColumnTool } from '@/tools/google_slides/delete_table_column'
import { deleteTableRowTool } from '@/tools/google_slides/delete_table_row'
import { deleteTextTool } from '@/tools/google_slides/delete_text'
import { duplicateObjectTool } from '@/tools/google_slides/duplicate_object'
import { exportPresentationTool } from '@/tools/google_slides/export_presentation'
import { getPageTool } from '@/tools/google_slides/get_page'
import { getThumbnailTool } from '@/tools/google_slides/get_thumbnail'
import { groupObjectsTool } from '@/tools/google_slides/group_objects'
import { insertTableColumnsTool } from '@/tools/google_slides/insert_table_columns'
import { insertTableRowsTool } from '@/tools/google_slides/insert_table_rows'
import { insertTextTool } from '@/tools/google_slides/insert_text'
import { mergeTableCellsTool } from '@/tools/google_slides/merge_table_cells'
import { readTool } from '@/tools/google_slides/read'
import { refreshSheetsChartTool } from '@/tools/google_slides/refresh_sheets_chart'
import { replaceAllShapesWithImageTool } from '@/tools/google_slides/replace_all_shapes_with_image'
import { replaceAllShapesWithSheetsChartTool } from '@/tools/google_slides/replace_all_shapes_with_sheets_chart'
import { replaceAllTextTool } from '@/tools/google_slides/replace_all_text'
import { replaceImageTool } from '@/tools/google_slides/replace_image'
import { rerouteLineTool } from '@/tools/google_slides/reroute_line'
import { ungroupObjectsTool } from '@/tools/google_slides/ungroup_objects'
import { unmergeTableCellsTool } from '@/tools/google_slides/unmerge_table_cells'
import { updateImagePropertiesTool } from '@/tools/google_slides/update_image_properties'
import { updateLineCategoryTool } from '@/tools/google_slides/update_line_category'
import { updateLinePropertiesTool } from '@/tools/google_slides/update_line_properties'
import { updatePageElementAltTextTool } from '@/tools/google_slides/update_page_element_alt_text'
import { updatePageElementTransformTool } from '@/tools/google_slides/update_page_element_transform'
import { updatePageElementsZOrderTool } from '@/tools/google_slides/update_page_elements_z_order'
import { updatePagePropertiesTool } from '@/tools/google_slides/update_page_properties'
import { updateParagraphStyleTool } from '@/tools/google_slides/update_paragraph_style'
import { updateShapePropertiesTool } from '@/tools/google_slides/update_shape_properties'
import { updateSlidePropertiesTool } from '@/tools/google_slides/update_slide_properties'
import { updateSlidesPositionTool } from '@/tools/google_slides/update_slides_position'
import { updateTableBorderPropertiesTool } from '@/tools/google_slides/update_table_border_properties'
import { updateTableCellPropertiesTool } from '@/tools/google_slides/update_table_cell_properties'
import { updateTableColumnPropertiesTool } from '@/tools/google_slides/update_table_column_properties'
import { updateTableRowPropertiesTool } from '@/tools/google_slides/update_table_row_properties'
import { updateTextStyleTool } from '@/tools/google_slides/update_text_style'
import { updateVideoPropertiesTool } from '@/tools/google_slides/update_video_properties'
import { writeTool } from '@/tools/google_slides/write'

export const googleSlidesReadTool = readTool
export const googleSlidesWriteTool = writeTool
export const googleSlidesCreateTool = createTool
export const googleSlidesReplaceAllTextTool = replaceAllTextTool
export const googleSlidesAddSlideTool = addSlideTool
export const googleSlidesGetThumbnailTool = getThumbnailTool
export const googleSlidesAddImageTool = addImageTool
export const googleSlidesGetPageTool = getPageTool
export const googleSlidesDeleteObjectTool = deleteObjectTool
export const googleSlidesDuplicateObjectTool = duplicateObjectTool
export const googleSlidesUpdateSlidesPositionTool = updateSlidesPositionTool
export const googleSlidesCreateTableTool = createTableTool
export const googleSlidesCreateShapeTool = createShapeTool
export const googleSlidesInsertTextTool = insertTextTool

export const googleSlidesUpdateTextStyleTool = updateTextStyleTool
export const googleSlidesUpdateParagraphStyleTool = updateParagraphStyleTool
export const googleSlidesDeleteTextTool = deleteTextTool
export const googleSlidesCreateParagraphBulletsTool = createParagraphBulletsTool
export const googleSlidesDeleteParagraphBulletsTool = deleteParagraphBulletsTool

export const googleSlidesReplaceAllShapesWithImageTool = replaceAllShapesWithImageTool
export const googleSlidesReplaceImageTool = replaceImageTool
export const googleSlidesUpdateImagePropertiesTool = updateImagePropertiesTool

export const googleSlidesUpdateShapePropertiesTool = updateShapePropertiesTool
export const googleSlidesUpdatePagePropertiesTool = updatePagePropertiesTool
export const googleSlidesUpdateSlidePropertiesTool = updateSlidePropertiesTool
export const googleSlidesUpdatePageElementAltTextTool = updatePageElementAltTextTool

export const googleSlidesUpdatePageElementTransformTool = updatePageElementTransformTool
export const googleSlidesUpdatePageElementsZOrderTool = updatePageElementsZOrderTool
export const googleSlidesGroupObjectsTool = groupObjectsTool
export const googleSlidesUngroupObjectsTool = ungroupObjectsTool

export const googleSlidesCreateLineTool = createLineTool
export const googleSlidesUpdateLinePropertiesTool = updateLinePropertiesTool
export const googleSlidesUpdateLineCategoryTool = updateLineCategoryTool
export const googleSlidesRerouteLineTool = rerouteLineTool

export const googleSlidesInsertTableRowsTool = insertTableRowsTool
export const googleSlidesInsertTableColumnsTool = insertTableColumnsTool
export const googleSlidesDeleteTableRowTool = deleteTableRowTool
export const googleSlidesDeleteTableColumnTool = deleteTableColumnTool
export const googleSlidesMergeTableCellsTool = mergeTableCellsTool
export const googleSlidesUnmergeTableCellsTool = unmergeTableCellsTool
export const googleSlidesUpdateTableCellPropertiesTool = updateTableCellPropertiesTool
export const googleSlidesUpdateTableBorderPropertiesTool = updateTableBorderPropertiesTool
export const googleSlidesUpdateTableColumnPropertiesTool = updateTableColumnPropertiesTool
export const googleSlidesUpdateTableRowPropertiesTool = updateTableRowPropertiesTool

export const googleSlidesCreateSheetsChartTool = createSheetsChartTool
export const googleSlidesRefreshSheetsChartTool = refreshSheetsChartTool
export const googleSlidesReplaceAllShapesWithSheetsChartTool = replaceAllShapesWithSheetsChartTool

export const googleSlidesCreateVideoTool = createVideoTool
export const googleSlidesUpdateVideoPropertiesTool = updateVideoPropertiesTool

export const googleSlidesBatchUpdateTool = batchUpdateTool
export const googleSlidesCopyPresentationTool = copyPresentationTool
export const googleSlidesExportPresentationTool = exportPresentationTool
