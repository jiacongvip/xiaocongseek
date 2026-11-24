import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'

export type RecordRailItem = {
  id: string
  title: string
  meta?: string
  status?: string
  statusTone?: 'ok' | 'fail' | 'run' | 'warn' | ''
  selected?: boolean
  entering?: boolean
  progress?: number
  thumb?: ReactNode
  actions?: ReactNode
  actionsAlways?: boolean
  onClick?: () => void
}

export type RecordRailModel = {
  title: string
  empty: string
  stamp?: string | number | boolean
  titleClick?: () => void
  head?: ReactNode
  items: RecordRailItem[]
}

export function recordRailSignature(model: RecordRailModel | null): string {
  if (!model) return ''
  return JSON.stringify({
    title: model.title,
    empty: model.empty,
    stamp: model.stamp ?? '',
    head: model.head ? '1' : '',
    items: model.items.map(item => ({
      id: item.id,
      title: item.title,
      meta: item.meta || '',
      status: item.status || '',
      statusTone: item.statusTone || '',
      selected: !!item.selected,
      entering: !!item.entering,
      progress: item.progress ?? '',
      actions: item.actions ? (item.actionsAlways ? 'always' : '1') : '',
      click: item.onClick ? '1' : '',
    })),
  })
}

export function shouldShowRecordRail(appPage: string, companyOpen: boolean, hasCompanyContext = true): boolean {
  if (appPage === 'home') return false
  if (appPage === 'companies') return companyOpen
  if (appPage === 'publish' || appPage === 'video-download' || appPage === 'industry-hotboard') return hasCompanyContext
  return appPage === 'create'
    || appPage === 'works'
    || appPage === 'materials'
    || appPage === 'calendar'
    || appPage === 'platform-accounts'
    || appPage === 'publish-packs'
}

export function defaultRecordRail(appPage: string, companyOpen: boolean): { title: string; empty: string } | null {
  if (appPage === 'create') return { title: '任务', empty: '还没有任务。生成后会出现在这里。' }
  if (appPage === 'works') return { title: '任务', empty: '还没有任务。' }
  if (appPage === 'companies' && companyOpen) return { title: '任务', empty: '这家还没有成片。' }
  if (appPage === 'materials') return { title: '素材', empty: '还没有素材。' }
  if (appPage === 'publish' || appPage === 'publish-packs') return { title: '发布包', empty: '还没有发布包' }
  if (appPage === 'calendar') return { title: '这天排期', empty: '这一天没有排期' }
  if (appPage === 'platform-accounts') return { title: '账号', empty: '还没有账号' }
  if (appPage === 'video-download') return { title: '采集', empty: '还没有采集任务。' }
  if (appPage === 'industry-hotboard') return { title: '热榜', empty: '还没有行业热榜。' }
  return null
}

type Registry = {
  publish: (owner: string, model: RecordRailModel) => void
  unpublish: (owner: string) => void
  view: RecordRailModel | null
  viewRef: RefObject<RecordRailModel | null>
}

const RecordRailContext = createContext<Registry | null>(null)

export function RecordRailProvider({ resetKey, children }: { resetKey: string; children: ReactNode }) {
  const storeRef = useRef({ key: resetKey, models: new Map<string, RecordRailModel>(), sig: '' })
  const viewRef = useRef<RecordRailModel | null>(null)
  const [view, setView] = useState<RecordRailModel | null>(null)
  if (storeRef.current.key !== resetKey) {
    storeRef.current = { key: resetKey, models: new Map(), sig: '' }
    viewRef.current = null
  }

  useEffect(() => {
    if (view !== null && storeRef.current.sig === '') setView(null)
  }, [resetKey, view])

  const api = useMemo<Omit<Registry, 'view'>>(() => ({
    viewRef,
    publish(owner, model) {
      storeRef.current.models.set(owner, model)
      const chosen = [...storeRef.current.models.values()].at(-1) || null
      viewRef.current = chosen
      const sig = recordRailSignature(chosen)
      if (sig !== storeRef.current.sig) {
        storeRef.current.sig = sig
        setView(chosen)
      }
    },
    unpublish(owner) {
      if (!storeRef.current.models.delete(owner)) return
      const chosen = [...storeRef.current.models.values()].at(-1) || null
      viewRef.current = chosen
      const sig = recordRailSignature(chosen)
      if (sig !== storeRef.current.sig) {
        storeRef.current.sig = sig
        setView(chosen)
      }
    },
  }), [])

  const value = useMemo(() => ({ ...api, view }), [api, view])
  return <RecordRailContext.Provider value={value}>{children}</RecordRailContext.Provider>
}

export function useRecordRail(model: RecordRailModel | null) {
  const ctx = useContext(RecordRailContext)
  const owner = useId()
  const publish = ctx?.publish
  const unpublish = ctx?.unpublish
  useEffect(() => {
    if (!publish || !unpublish) return
    if (model) publish(owner, model)
    else unpublish(owner)
  }, [publish, unpublish, owner, model])
  useEffect(() => {
    if (!unpublish) return
    return () => unpublish(owner)
  }, [unpublish, owner])
}

export function useRegisteredRecordRail(): RecordRailModel | null {
  const ctx = useContext(RecordRailContext)
  if (!ctx) return null
  return ctx.viewRef.current || ctx.view
}

export function useRecordRailViewRef(): RefObject<RecordRailModel | null> | null {
  return useContext(RecordRailContext)?.viewRef ?? null
}
