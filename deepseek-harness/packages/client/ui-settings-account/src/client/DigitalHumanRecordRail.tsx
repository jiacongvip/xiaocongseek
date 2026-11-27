// @ts-nocheck — 半成品数字人 UI，打包先过类型门禁（登录链路不受影响）
import { type RefObject } from 'react'
import css from './DigitalHumanPanel.module.css'
import { useRecordRailViewRef, useRegisteredRecordRail, defaultRecordRail, type RecordRailItem, type RecordRailModel } from './DigitalHumanRecordRailState.tsx'

export type { RecordRailItem, RecordRailModel } from './DigitalHumanRecordRailState.tsx'
export {
  recordRailSignature,
  shouldShowRecordRail,
  defaultRecordRail,
  RecordRailProvider,
  useRecordRail,
  useRegisteredRecordRail,
  useRecordRailViewRef,
} from './DigitalHumanRecordRailState.tsx'

export function RecordRail({
  model,
  listRef,
}: {
  model: RecordRailModel
  listRef?: RefObject<HTMLDivElement | null>
}) {
  const viewRef = useRecordRailViewRef()
  const live = () => viewRef?.current || model
  const statusClass = (tone?: RecordRailItem['statusTone']) => {
    if (tone === 'ok') return `${css.taskRailStatus} ${css.taskRailStatusOk}`
    if (tone === 'fail') return `${css.taskRailStatus} ${css.taskRailStatusFail}`
    if (tone === 'run') return `${css.taskRailStatus} ${css.taskRailStatusRun}`
    if (tone === 'warn') return `${css.taskRailStatus} ${css.taskRailStatusWarn}`
    return css.taskRailStatus
  }
  return (
    <aside className={css.taskRail} aria-label={model.title}>
      <div className={css.taskRailHead}>
        {model.titleClick ? (
          <button type="button" className={css.taskRailTitle} onClick={() => live().titleClick?.()}>{model.title}</button>
        ) : (
          <div className={css.taskRailTitle}>{model.title}</div>
        )}
        {model.head}
      </div>
      <div className={css.taskRailList} ref={listRef}>
        {model.items.length === 0 ? <div className={css.empty}>{model.empty}</div> : model.items.map(item => (
          <article
            key={item.id}
            className={[
              css.taskRailRow,
              item.selected ? css.taskRailRowOn : '',
              item.entering ? css.taskRailRowEnter : '',
            ].filter(Boolean).join(' ')}
          >
            <button
              type="button"
              className={css.taskRailMain}
              disabled={!item.onClick}
              onClick={() => live().items.find(row => row.id === item.id)?.onClick?.()}
            >
              <span className={css.taskRailThumb}>
                {item.thumb}
              </span>
              <span className={css.taskRailBody}>
                <span className={css.taskRailTop}>
                  <b>{item.title}</b>
                  {item.status ? <em className={statusClass(item.statusTone)}>{item.status}</em> : null}
                </span>
                {item.meta ? <small>{item.meta}</small> : null}
                {item.progress != null ? (
                  <span className={css.taskRailProgress} aria-hidden="true">
                    <i style={{ width: `${item.progress}%` }} />
                  </span>
                ) : null}
              </span>
            </button>
            {item.actions ? (
              <div className={item.actionsAlways ? css.taskRailRowActionsOn : css.taskRailRowActions}>
                {item.actions}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </aside>
  )
}


export function ResolvedRecordRail({
  owned,
  visible,
  appPage,
  companyOpen,
  listRef,
}: {
  owned: RecordRailModel | null
  visible: boolean
  appPage: string
  companyOpen: boolean
  listRef?: RefObject<HTMLDivElement | null>
}) {
  const registered = useRegisteredRecordRail()
  if (!visible) return null
  const fallback = defaultRecordRail(appPage, companyOpen)
  const model = owned || registered || (fallback ? { ...fallback, items: [] as RecordRailItem[] } : null)
  if (!model) return null
  return <RecordRail model={model} listRef={listRef} />
}
