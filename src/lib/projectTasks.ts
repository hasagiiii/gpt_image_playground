import type { TaskRecord } from '../types'

export const LOCAL_PROJECT_ID = '__local_project__'

export function taskBelongsToProject(task: TaskRecord, projectId: string) {
  return projectId === LOCAL_PROJECT_ID ? !task.projectId : task.projectId === projectId
}

export function getProjectTaskSnapshot(tasks: TaskRecord[], projectId: string | null) {
  if (!projectId) return [...tasks]
  return tasks.filter((task) => taskBelongsToProject(task, projectId))
}
