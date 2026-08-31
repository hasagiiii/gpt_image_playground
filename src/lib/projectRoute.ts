const PROJECT_QUERY_PARAM = 'project'
const ADMIN_USERS_USER_QUERY_PARAM = 'user'
const ADMIN_USERS_PROJECT_QUERY_PARAM = 'project'
const MATERIALS_PATH = '/materials'
const ADMIN_PATH = '/admin/announcements'
const ADMIN_USERS_PATH = '/admin/users'

export function getAppViewFromUrl(href = window.location.href): 'workspace' | 'materials' | 'admin' | 'admin-users' {
  const path = new URL(href).pathname.replace(/\/+$/, '')
  if (path === MATERIALS_PATH) return 'materials'
  if (path === ADMIN_USERS_PATH) return 'admin-users'
  if (path === ADMIN_PATH) return 'admin'
  return 'workspace'
}

export function getProjectIdFromUrl(href = window.location.href) {
  const value = new URL(href).searchParams.get(PROJECT_QUERY_PARAM)?.trim()
  return value || null
}

export function getProjectUrl(projectId: string | null, href = window.location.href) {
  const url = new URL(href)
  if (projectId) url.searchParams.set(PROJECT_QUERY_PARAM, projectId)
  else url.searchParams.delete(PROJECT_QUERY_PARAM)
  return `${url.pathname}${url.search}${url.hash}`
}

export function updateProjectUrl(projectId: string | null, replace = false) {
  const url = getProjectUrl(projectId)
  if (replace) {
    window.history.replaceState(null, '', url)
    return
  }
  window.history.pushState(null, '', url)
}

export function updateMaterialsUrl(replace = false) {
  const url = new URL(window.location.href)
  url.pathname = MATERIALS_PATH
  url.search = ''
  url.hash = ''
  const next = `${url.pathname}${url.search}${url.hash}`
  if (replace) window.history.replaceState(null, '', next)
  else window.history.pushState(null, '', next)
}

export function updateAdminUrl(replace = false) {
  const url = new URL(window.location.href)
  url.pathname = ADMIN_PATH
  url.search = ''
  url.hash = ''
  const next = `${url.pathname}${url.search}${url.hash}`
  if (replace) window.history.replaceState(null, '', next)
  else window.history.pushState(null, '', next)
}

export function getAdminUsersSelectionFromUrl(href = window.location.href) {
  const url = new URL(href)
  const userId = url.searchParams.get(ADMIN_USERS_USER_QUERY_PARAM)?.trim()
  const projectId = userId ? url.searchParams.get(ADMIN_USERS_PROJECT_QUERY_PARAM)?.trim() : ''
  return {
    userId: userId || null,
    projectId: projectId || null,
  }
}

export function getAdminUsersUrl(userId: string | null, projectId: string | null, href = window.location.href) {
  const url = new URL(href)
  url.pathname = ADMIN_USERS_PATH
  url.search = ''
  url.hash = ''
  if (userId) url.searchParams.set(ADMIN_USERS_USER_QUERY_PARAM, userId)
  if (userId && projectId) url.searchParams.set(ADMIN_USERS_PROJECT_QUERY_PARAM, projectId)
  return `${url.pathname}${url.search}${url.hash}`
}

export function updateAdminUsersUrl(userId: string | null, projectId: string | null, replace = false) {
  const next = getAdminUsersUrl(userId, projectId)
  if (replace) window.history.replaceState(null, '', next)
  else window.history.pushState(null, '', next)
}

export function updateWorkspaceUrl(projectId: string | null, replace = false) {
  const url = new URL(window.location.href)
  url.pathname = '/'
  url.search = ''
  url.hash = ''
  if (projectId) url.searchParams.set(PROJECT_QUERY_PARAM, projectId)
  const next = `${url.pathname}${url.search}${url.hash}`
  if (replace) window.history.replaceState(null, '', next)
  else window.history.pushState(null, '', next)
}
