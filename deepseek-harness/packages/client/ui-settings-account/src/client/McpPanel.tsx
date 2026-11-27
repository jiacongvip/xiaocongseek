/** MCP service panel rendered inside the Account settings section. */

import { useCallback, useEffect, useState } from 'react'
import type { AccountKey } from './locales.ts'
import css from './McpPanel.module.css'

interface McpAgent {
  key: string
  label: string
  enabled: boolean
  present: boolean
  error?: string
}

interface McpStatus {
  success: boolean
  running: boolean
  port: number
  url: string
  serverName: string
  toolCount: number
  error?: string
  agents: McpAgent[]
}

interface McpPanelProps {
  t: (key: AccountKey) => string
}

function buildAgentPrompt(url: string, serverName: string): string {
  return [
    `你已接入本机 Xiaocongseek 全流程视频创作与发布 MCP 服务（服务名：${serverName}，地址：${url}）。`,
    `当用户要求配音、做数字人、生图、剪辑、加字幕、套模板、生成多平台文案封面、查行业热榜、或排期发布到抖音/小红书/视频号时，优先调用 xiaocong_* MCP 工具完成，不要手写复杂 ffmpeg 命令。`,
    '',
    '【核心能力与工具清单】',
    '1. 公司空间与公司档案（写文案/剪片前优先读）：',
    '   - xiaocong_company_list / xiaocong_company_brief / xiaocong_company_select / xiaocong_company_brief_update',
    '   - xiaocong_materials_list(space?) / xiaocong_works_list(space?) / xiaocong_work_import(path, space?, name?)',
    '2. 配音（TTS）、音色、音乐、音效与文件上传：',
    '   - xiaocong_voices_list：查看预设配音风格（热心老板/避坑提醒/稳重师傅/带看效果）与已克隆音色',
    '   - xiaocong_tts(text, voice?, voice_id?, instruction?, space?)：文字直接转配音 mp3，返回本地路径、URL 与时长',
    '   - xiaocong_music_list / xiaocong_sfx_list：查询内置 BGM 垫乐与音效库路径',
    '   - xiaocong_upload_local(path)：上传本机图片/音视频拿公网 URL（克隆形象/音色、图生图前置）',
    '3. 数字人与生图：',
    '   - xiaocong_digital_human_resources / xiaocong_digital_human_defaults / xiaocong_style_library',
    '   - xiaocong_digital_human_speak(text)：用默认形象+音色一句话直出数字人视频',
    '   - xiaocong_digital_human_create(model="xdh-*", payload) + xiaocong_digital_human_task(id)',
    '   - xiaocong_image_models / xiaocong_image_create / xiaocong_image_task',
    '4. 引擎、字幕转写、网感口播、渲染、质检与抠图：',
    '   - xiaocong_status / xiaocong_engine_doctor / xiaocong_engine_start / xiaocong_engine_stop / xiaocong_cache_clean',
    '   - xiaocong_capabilities / xiaocong_pack_options / xiaocong_fonts / xiaocong_fonts_install',
    '   - xiaocong_transcribe / xiaocong_srt_export：本地语音转字幕（词级时间轴）与导出 SRT',
    '   - xiaocong_trendy_koubo：一键「网感口播」三合一模板（trendy_red / trendy_gold / trendy_cyan）直出 mp4 或剪映草稿',
    '   - xiaocong_render / xiaocong_render_status / xiaocong_render_cancel / xiaocong_render_batch / xiaocong_render_batch_status',
    '   - xiaocong_qc_video / xiaocong_matte_webm / xiaocong_preview_range',
    '   - xiaocong_templates / xiaocong_template_apply / xiaocong_template_save / xiaocong_recipes',
    '   - xiaocong_project_list / xiaocong_project_load / xiaocong_project_save / xiaocong_project_saveas / xiaocong_draft_list / xiaocong_draft_create / xiaocong_draft_save',
    '5. 成片多平台文案与封面：',
    '   - xiaocong_work_copy / xiaocong_work_copy_revise：生成并修改抖音/小红书/视频号标题正文话题',
    '   - xiaocong_work_cover / xiaocong_work_cover_frame / xiaocong_work_cover_text：AI 画封面、抽帧封面、封面加字',
    '6. 选题热榜、社媒采集、评论词云与复盘：',
    '   - xiaocong_hotboard / xiaocong_media_ingest / xiaocong_media_ingest_status',
    '   - xiaocong_platform_media / xiaocong_platform_media_status / xiaocong_comment_wordcloud',
    '   - xiaocong_account_monitor / xiaocong_retro_review',
    '7. 多平台账号、排期日历与一键发布：',
    '   - xiaocong_accounts_list：查看已授权抖音/小红书/视频号/快手账号与发布任务总览',
    '   - xiaocong_publish_calendar_list / xiaocong_publish_calendar_update：读写发布日历排期',
    '   - xiaocong_publish_packs_list / xiaocong_publish_packs_action：管理发布包',
    '   - xiaocong_publish_now：查可发账号（action="accounts"）或立即发布排期（action="fire"）',
    '',
    '【推荐工作流（带公司档案全闭环）】',
    '1. 先调 xiaocong_company_brief（传公司名）读取档案；若引擎离线先调 xiaocong_engine_start。',
    '2. 需要配音先调 xiaocong_voices_list + xiaocong_tts；需要素材调 xiaocong_materials_list 或 xiaocong_hotboard / xiaocong_platform_media。',
    '3. 调 xiaocong_trendy_koubo 或 xiaocong_render 出片，轮询 xiaocong_render_status(task_id) 直到 status="done"。',
    '4. 调 xiaocong_work_copy + xiaocong_work_cover 生成多平台文案与封面，再用 xiaocong_publish_calendar_update / xiaocong_publish_now 排期或发布。',
    '',
    '【xiaocong_render 的 payload 配方示例】',
    JSON.stringify({
      recipe: {
        name: '快剪成片',
        size: [1080, 1920],
        clips: [{ source: '/本地绝对路径/video.mp4', start: 0 }],
        subtitles: { mode: 'auto', source: 'clips[0]', style: 'keyword', avoid_face: true, highlight: { mode: 'auto' } },
        audio: { voice_fx: 'clean', bgm: { mode: 'auto', volume: 0.12, duck: true } },
        rhythm: { cut_on_pause: true },
        look: { lut: 'warm_soft', strength: 0.8 },
        texts: [{ text: '开场重点', style: 'hook_yellow', start: 0.3, end: 2.5, avoid: 'person', intro: 'Slide_Up' }],
      },
      preset: 'final',
    }, null, 2),
  ].join('\n')
}

export function McpPanel({ t }: McpPanelProps) {
  const [status, setStatus] = useState<McpStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copiedPrompt, setCopiedPrompt] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/xiaocong/mcp/status', { headers: { accept: 'application/json' } })
      const body = await response.json() as McpStatus
      if (body?.success) setStatus(body)
    } catch {
      // The shell route may be unavailable on very old builds; keep the panel quiet.
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const toggle = async (agent: string, enabled: boolean) => {
    setBusy(true)
    try {
      const response = await fetch('/xiaocong/mcp/bind', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agent, enabled }),
      })
      const body = await response.json() as McpStatus
      if (body?.success) setStatus(body)
    } catch {
      // keep the previous state on failure
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!status) return
    try {
      await navigator.clipboard.writeText(JSON.stringify({ xiaocongseek: { url: status.url } }, null, 2))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard may be denied; the JSON stays visible for manual copy
    }
  }

  const copyPrompt = async () => {
    if (!status) return
    try {
      await navigator.clipboard.writeText(buildAgentPrompt(status.url, status.serverName || 'xiaocongseek'))
      setCopiedPrompt(true)
      window.setTimeout(() => setCopiedPrompt(false), 2000)
    } catch {
      // clipboard may be denied; the prompt stays visible for manual copy
    }
  }

  if (!status) return null

  const agentPrompt = buildAgentPrompt(status.url, status.serverName || 'xiaocongseek')

  return (
    <div className={css.panel}>
      <h3 className={css.title}>{t('mcpTitle')}</h3>
      <p className={css.intro}>{t('mcpIntro')}</p>

      <div className={css.statusRow}>
        <span className={status.running ? css.dotOn : css.dotOff} aria-hidden />
        <span className={status.running ? css.running : css.stopped}>{status.running ? t('mcpRunning') : t('mcpStopped')}</span>
        {status.running && (
          <>
            <span className={css.secondary}>{t('mcpAddress')}</span>
            <code className={css.url}>{status.url}</code>
            <span className={css.secondary}>{String(status.toolCount)}{t('mcpToolCount')}</span>
          </>
        )}
        {!status.running && status.error !== undefined && <span className={css.error}>{status.error}</span>}
      </div>

      <div className={css.agents}>
        {status.agents.map(agent => (
          <div key={agent.key} className={css.agentRow}>
            <span className={css.agentLabel}>{agent.label}</span>
            {agent.error !== undefined && <span className={css.error} title={agent.error}>{t('mcpWriteFailed')}</span>}
            <button
              type="button"
              className={agent.enabled ? css.toggleOn : css.toggleOff}
              disabled={busy}
              onClick={() => void toggle(agent.key, !agent.enabled)}
            >
              {agent.enabled ? 'ON' : 'OFF'}
            </button>
          </div>
        ))}
      </div>

      <div className={css.config}>
        <div className={css.configHeader}>
          <span className={css.configTitle}>{t('mcpCopyConfig')}</span>
          <button type="button" className={css.copyButton} onClick={() => void copy()}>{copied ? t('mcpCopied') : t('mcpCopy')}</button>
        </div>
        <p className={css.hint}>{t('mcpCopyHint')}</p>
        <pre className={css.json}>{JSON.stringify({ xiaocongseek: { url: status.url } }, null, 2)}</pre>
      </div>

      <div className={css.config}>
        <div className={css.configHeader}>
          <span className={css.configTitle}>{t('mcpPromptTitle')}</span>
          <button type="button" className={css.copyButton} onClick={() => void copyPrompt()}>{copiedPrompt ? t('mcpCopied') : t('mcpCopyPrompt')}</button>
        </div>
        <p className={css.hint}>{t('mcpPromptHint')}</p>
        <pre className={css.prompt}>{agentPrompt}</pre>
      </div>
    </div>
  )
}
