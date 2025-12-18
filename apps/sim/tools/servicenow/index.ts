import { createRecordTool } from '@/tools/servicenow/create_record'
import { deleteRecordTool } from '@/tools/servicenow/delete_record'
import { readRecordTool } from '@/tools/servicenow/read_record'
import { updateRecordTool } from '@/tools/servicenow/update_record'

export {
  createRecordTool as servicenowCreateRecordTool,
  readRecordTool as servicenowReadRecordTool,
  updateRecordTool as servicenowUpdateRecordTool,
  deleteRecordTool as servicenowDeleteRecordTool,
}
