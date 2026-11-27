/** Conversation digest: memories, artifacts, jobs, skills, and media for this session. */
import { useEffect, useState, type ReactNode } from 'react'
import {
  FileTypeIcon,
  IconFlatListOutlineRegular,
  IconFolderOpenOutlineRegular,
  IconPinOutlineRegular,
  IconPlusOutlineRegular,
  IconSkillOutlineRegular,
  IconSparkleRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import {
  CONVERSATION_DIGEST_ID,
  CONVERSATION_DIGEST_KIND,
  loadConversationDigest,
  type ConversationDigestSnapshot,
} from './conversation-digest.ts'
import css from './ConversationDigest.module.css'

export { CONVERSATION_DIGEST_ID, CONVERSATION_DIGEST_KIND }

const EMPTY: ConversationDigestSnapshot = {
  memories: [], artifacts: [], resources: [], media: [], files: [], skills: [],
}

export function conversationDigestDefinition(): SidebarRightTabDefinition {
  return {
    id: CONVERSATION_DIGEST_ID,
    kind: CONVERSATION_DIGEST_KIND,
    priority: 'extension',
    title: () => '对话摘要',
    guide: [{
      id: 'open',
      order: 4,
      title: () => '对话摘要',
      description: () => '本对话的记忆、产物、任务和素材',
    }],
  }
}

export interface ConversationDigestInjected {
  hooks: {
    jobs: {
      getSnapshot: () => { rows?: Record<string, readonly { id: string; kind: string; label: string }[]> }
      subscribe: (listener: () => void) => () => void
    }
  }
  watchRows: (sessionId: SessionId) => () => void
  openDigitalHuman: () => void
  openFiles: () => void
}

export type ConversationDigestProps =
  PropsRuntime<'sidebar.right.pane.tab'> & InjectFace<ConversationDigestInjected>

export type ConversationDigestTitleProps = PropsRuntime<'sidebar.right.pane.tab.title'>

export type ConversationDigestButtonProps =
  PropsRuntime<'conversation.session.header.actions'> & InjectFace<{ openDigest: () => void }>

export function ConversationDigestTitle(): ReactNode {
  return (
    <>
      <IconFlatListOutlineRegular size={16} className={css.titleIcon} />
      对话摘要
    </>
  )
}

export function ConversationDigestButton({ openDigest }: ConversationDigestButtonProps): ReactNode {
  return (
    <button type="button" className={css.trigger} onClick={openDigest}>
      <IconFlatListOutlineRegular size={14} />
      对话摘要
    </button>
  )
}

export function ConversationDigest({
  sessionId, useJobs, watchRows, openDigitalHuman, openFiles, useTabInfo,
}: ConversationDigestProps): ReactNode {
  const { tab } = useTabInfo()
  const [digest, setDigest] = useState<ConversationDigestSnapshot>(EMPTY)
  const jobs = useJobs(state => state.rows?.[sessionId] ?? [])
  useEffect(() => watchRows?.(sessionId), [sessionId, watchRows])
  useEffect(() => {
    let alive = true
    const refresh = () => {
      void loadConversationDigest(sessionId).then((next) => { if (alive) setDigest(next) })
    }
    refresh()
    window.addEventListener('xdh-digital-human-history', refresh)
    window.addEventListener('xdh-digital-human-space', refresh)
    return () => {
      alive = false
      window.removeEventListener('xdh-digital-human-history', refresh)
      window.removeEventListener('xdh-digital-human-space', refresh)
    }
  }, [sessionId])
  useEffect(() => tab.actions.bindCommands({ refresh: () => {
    void loadConversationDigest(sessionId).then(setDigest)
  } }), [tab.actions, sessionId])
  const openArtifact = (id: string) => {
    openDigitalHuman?.()
    void id
  }
  return (
    <section className={css.root} aria-label="对话摘要">
      <header className={css.header}>
        <span className={css.title}>对话摘要</span>
        <div className={css.headerActions}>
          <button type="button" className={css.iconButton} aria-label="刷新" onClick={() => {
            void loadConversationDigest(sessionId).then(setDigest)
          }}>
            <IconFlatListOutlineRegular size={14} />
          </button>
          <button type="button" className={css.iconButton} aria-label="去创作" onClick={() => openDigitalHuman?.()}>
            <IconPlusOutlineRegular size={14} />
          </button>
        </div>
      </header>
      <div className={css.body}>
        <DigestSection title="相关记忆">
          {digest.memories.length === 0
            ? <div className={css.empty}>这家公司还没档案，补档案后会出现在这里</div>
            : digest.memories.map(item => (
              <button type="button" key={item.id} className={css.row} onClick={() => openDigitalHuman?.()}>
                <IconPinOutlineRegular size={14} className={css.rowIcon} />
                <span className={css.rowLabel}>{item.text}</span>
              </button>
            ))}
        </DigestSection>
        <DigestSection title="对话产物" extra={<button type="button" className={css.iconButton} aria-label="新建产物"
          onClick={() => openDigitalHuman?.()}><IconPlusOutlineRegular size={12} /></button>}>
          {digest.artifacts.length === 0
            ? <div className={css.empty}>成片和草稿会列在这里</div>
            : digest.artifacts.map((item, index) => (
              <button type="button" key={item.id} className={`${css.row} ${index === 0 ? css.rowActive : ''}`}
                onClick={() => openArtifact(item.id)}>
                <IconSparkleRegular size={14} className={css.rowIcon} />
                <span className={css.rowLabel}>{item.title}</span>
              </button>
            ))}
        </DigestSection>
        <DigestSection title="对话资源">
          {digest.resources.length === 0
            ? <div className={css.empty}>生成的图片和视频会出现在这里</div>
            : <>
              {digest.resources.slice(0, 5).map(item => (
                <button type="button" key={item.id} className={css.row} onClick={() => openArtifact(item.id)}>
                  {item.coverUrl
                    ? <img className={css.thumb} src={item.coverUrl} alt="" />
                    : <FileTypeIcon kind="image" size={16} className={css.rowIcon} />}
                  <span className={css.rowLabel}>{item.title}</span>
                </button>
              ))}
              {digest.resources.length > 5 && <button type="button" className={css.more} onClick={() => openDigitalHuman?.()}>查看更多</button>}
            </>}
        </DigestSection>
        <DigestSection title="后台任务">
          {jobs.length === 0
            ? <div className={css.empty}>当前对话没有后台任务</div>
            : jobs.slice(0, 6).map(job => (
              <div key={job.id} className={css.row}>
                <IconFolderOpenOutlineRegular size={14} className={css.rowIcon} />
                <span className={css.rowLabel}>{job.label || job.kind}</span>
              </div>
            ))}
        </DigestSection>
        <DigestSection title="技能">
          {digest.skills.map(skill => (
            <div key={skill.id} className={css.row}>
              <IconSkillOutlineRegular size={14} className={css.rowIcon} />
              <span className={css.rowLabel}>{skill.name}</span>
            </div>
          ))}
        </DigestSection>
        <DigestSection title="图片与视频">
          {digest.media.length === 0
            ? <div className={css.empty}>还没有生成素材</div>
            : <div className={css.thumbs}>
              {digest.media.map(item => (
                <button type="button" key={item.id} className={css.thumb} title={item.title}
                  onClick={() => openArtifact(item.id)}>
                  {item.coverUrl || item.mediaUrl
                    ? <img src={item.coverUrl || item.mediaUrl} alt="" />
                    : null}
                </button>
              ))}
            </div>}
        </DigestSection>
        <DigestSection title="最近文件">
          {digest.files.length === 0
            ? <button type="button" className={css.more} onClick={() => openFiles?.()}>打开工作区文件</button>
            : digest.files.map(file => (
              <button type="button" key={file.id} className={css.row} onClick={() => openFiles?.()}>
                <FileTypeIcon kind="other" size={16} className={css.rowIcon} />
                <span className={css.rowLabel}>{file.name}</span>
              </button>
            ))}
        </DigestSection>
      </div>
    </section>
  )
}

function DigestSection({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className={css.section}>
      <div className={css.sectionHead}>
        <span className={css.sectionTitle}>{title}</span>
        {extra}
      </div>
      {children}
    </section>
  )
}
