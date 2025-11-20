import { createBucketTool } from '@/tools/microsoft_planner/create_bucket'
import { createTaskTool } from '@/tools/microsoft_planner/create_task'
import { deleteBucketTool } from '@/tools/microsoft_planner/delete_bucket'
import { deleteTaskTool } from '@/tools/microsoft_planner/delete_task'
import { getTaskDetailsTool } from '@/tools/microsoft_planner/get_task_details'
import { listBucketsTool } from '@/tools/microsoft_planner/list_buckets'
import { listPlansTool } from '@/tools/microsoft_planner/list_plans'
import { readBucketTool } from '@/tools/microsoft_planner/read_bucket'
import { readPlanTool } from '@/tools/microsoft_planner/read_plan'
import { readTaskTool } from '@/tools/microsoft_planner/read_task'
import { updateBucketTool } from '@/tools/microsoft_planner/update_bucket'
import { updateTaskTool } from '@/tools/microsoft_planner/update_task'
import { updateTaskDetailsTool } from '@/tools/microsoft_planner/update_task_details'

export const microsoftPlannerCreateTaskTool = createTaskTool
export const microsoftPlannerReadTaskTool = readTaskTool
export const microsoftPlannerUpdateTaskTool = updateTaskTool
export const microsoftPlannerDeleteTaskTool = deleteTaskTool
export const microsoftPlannerListPlansTool = listPlansTool
export const microsoftPlannerReadPlanTool = readPlanTool
export const microsoftPlannerListBucketsTool = listBucketsTool
export const microsoftPlannerReadBucketTool = readBucketTool
export const microsoftPlannerCreateBucketTool = createBucketTool
export const microsoftPlannerUpdateBucketTool = updateBucketTool
export const microsoftPlannerDeleteBucketTool = deleteBucketTool
export const microsoftPlannerGetTaskDetailsTool = getTaskDetailsTool
export const microsoftPlannerUpdateTaskDetailsTool = updateTaskDetailsTool
