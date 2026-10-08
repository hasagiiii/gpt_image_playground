import type { Project, TaskRecord } from '../types'

export const LOCAL_PROJECT_ID = '__local_project__'
export const LOCAL_IMAGE_CREATION_ERROR = '本地模式不支持新增图片，请先切换到在线项目'

export function isLocalProject(projectId: string | null | undefined, projects: Project[]) {
  return !projectId || projectId === LOCAL_PROJECT_ID || projects.some((project) => project.id === projectId && project.storage !== 'online')
}

export function taskBelongsToProject(task: TaskRecord, projectId: string) {
  return projectId === LOCAL_PROJECT_ID ? !task.projectId : task.projectId === projectId
}

export function getProjectTaskSnapshot(tasks: TaskRecord[], projectId: string | null) {
  if (!projectId) return [...tasks]
  return tasks.filter((task) => taskBelongsToProject(task, projectId))
}
