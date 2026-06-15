export function mapTodoistTask(task: any) {
  return {
    id: task.id,
    content: task.content,
    description: task.description || '',
    projectId: task.project_id || '',
    priority: task.priority,
    url: task.url,
    isCompleted: task.is_completed ?? false,
    createdAt: task.created_at,
    due: task.due
      ? {
          date: task.due.date,
          string: task.due.string,
          isRecurring: task.due.is_recurring,
        }
      : null,
    labels: task.labels || [],
  }
}

export function mapTodoistProject(project: any) {
  return {
    id: project.id,
    name: project.name,
    color: project.color,
    isFavorite: project.is_favorite ?? false,
    isInboxProject: project.is_inbox_project ?? false,
    viewStyle: project.view_style || 'list',
  }
}

export function mapTodoistComment(comment: any) {
  return {
    id: comment.id,
    content: comment.content,
    postedAt: comment.posted_at,
    taskId: comment.task_id || '',
  }
}
