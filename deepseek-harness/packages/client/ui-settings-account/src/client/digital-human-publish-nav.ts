/** Pure helpers for the workbench side-nav Publish / Video-download entries. No network or storage. */
export type SideNavItem = 'home' | 'companies' | 'publish' | 'video-download' | 'industry-hotboard'

/** Company-scoped pages keep the Companies nav active; top-level Publish / Video-download are separate. */
export function isSideNavOn(appPage: string, item: SideNavItem): boolean {
  if (item === 'home') return appPage === 'home'
  // 发布总览页已下线，发布包页是唯一入口，侧栏「发布」在两处都要亮。
  if (item === 'publish') return appPage === 'publish' || appPage === 'publish-packs'
  if (item === 'video-download') return appPage === 'video-download'
  if (item === 'industry-hotboard') return appPage === 'industry-hotboard'
  return appPage === 'companies'
    || appPage === 'create'
    || appPage === 'works'
    || appPage === 'materials'
    || appPage === 'calendar'
    || appPage === 'publish-packs'
    || appPage === 'platform-accounts'
}

export type PublishCompanyResolution<T extends { id: string }> =
  | { status: 'empty' }
  | { status: 'pick'; spaces: T[] }
  | { status: 'ready'; space: T }

/**
 * Resolve which company the Publish / Video-download page should manage.
 * Keeps the current spaceId when it is an explicit known company.
 * Never invents / silently falls back to another company.
 */
export function resolvePublishCompany<T extends { id: string }>(
  spaces: T[],
  spaceId: string,
): PublishCompanyResolution<T> {
  const list = Array.isArray(spaces) ? spaces.filter(item => item && typeof item.id === 'string' && item.id) : []
  if (!list.length) return { status: 'empty' }
  const id = String(spaceId || '').trim()
  const space = id ? list.find(item => item.id === id) : undefined
  if (!space) return { status: 'pick', spaces: list }
  return { status: 'ready', space }
}
