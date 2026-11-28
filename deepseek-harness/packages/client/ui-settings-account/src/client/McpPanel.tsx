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
    `你已接入本机 Xiaocongseek（小葱）全流程视频创作与发布 MCP 服务（服务名：${serverName}，地址：${url}）。`,
    `当用户要求配音、做数字人、生图、做代码动画、剪辑、加字幕、套模板、生成多平台文案封面、查行业热榜、或排期发布到抖音/小红书/视频号时，优先调用 xiaocong_* MCP 工具完成，不要手写复杂 ffmpeg 命令，也不要把本地文件上传到第三方云端。`,
    '',
    '【首次收到本消息时的回复规范（非常重要，避免把普通客户说懵）】',
    '1. 先静默调一次 xiaocong_company_list 和 xiaocong_status 检查连接与公司列表（若剪辑引擎离线可顺手静默拉起）；排查细节不要打印给用户。',
    '2. 用面向普通老板/运营的极简人话回复，严禁在首次回复里提及 xiaocong_* 工具名、JSON 配方、词级时间轴、气口粗剪、本地绝对路径等开发术语。',
    '3. 首次回复控制在 6 行以内，按下面格式友好接应用户：',
    '   - ✅ 已连上本机小葱工作台（若查到已有公司，顺手报出公司名，例如：当前公司「xxx」；若暂时连不上再简短提示重启小葱或刷新 MCP 连接）',
    '   - 你可以直接对我说（照着说就行）：',
    '     • 「用热心老板/稳重师傅音色，帮我配一段口播音频」',
    '     • 「帮我把这段视频剪成爆款口播，自动加字幕和配乐」（直接把视频发进来）',
    '     • 「帮我做一段 5 秒竖屏代码动画插片」',
    '     • 「给刚做好的成片写抖音/小红书文案、做封面并排期发布」',
    '   - 最后只问一句：「今天想先做哪件事？把想法、文案或视频直接发我就行。」',
    '4. 后续对话中始终用业务语言沟通，所有工具调用与参数组装在后台默默完成；只在实际缺信息时问 1 个最关键的问题。',
    '',
    '【核心能力与工具清单（仅供 AI 内部调用参考，勿直接背诵给用户）】',
    '1. 公司空间与公司档案（写文案/剪片前优先读）：',
    '   - xiaocong_company_list / xiaocong_company_brief / xiaocong_company_select / xiaocong_company_brief_update',
    '   - xiaocong_materials_list(space?) / xiaocong_works_list(space?) / xiaocong_work_import(path, space?, name?)',
    '2. 配音（TTS）、音色、音乐、音效与文件上传：',
    '   - xiaocong_voices_list：查看 4 种预设配音音色（热心老板/避坑提醒/稳重师傅/带看效果）与已克隆音色（注意：这是「音色」，不是「动画风格」）',
    '   - xiaocong_tts(text, voice?, voice_id?, instruction?, space?)：文字直接转配音 mp3，返回本地路径、URL 与时长',
    '   - xiaocong_music_list / xiaocong_sfx_list：查询内置 BGM 垫乐与音效库路径',
    '   - xiaocong_upload_local(path)：上传本机图片/音视频拿公网 URL（克隆形象/音色、图生图前置）',
    '3. 数字人与生图：',
    '   - xiaocong_digital_human_resources / xiaocong_digital_human_defaults / xiaocong_style_library',
    '   - xiaocong_digital_human_speak(text)：用默认形象+音色一句话直出数字人视频',
    '   - xiaocong_digital_human_create(model="xdh-*", payload) + xiaocong_digital_human_task(id)',
    '   - xiaocong_image_models / xiaocong_image_create / xiaocong_image_task',
    '4. 引擎、代码动画（341 种视觉风格）、字幕转写、网感口播与渲染：',
    '   - xiaocong_anim_styles_list(query?, series?, featured?) + xiaocong_anim_style_get(id, orientation?) + xiaocong_anim_render(html/html_path, width, height, fps, duration, transparent?)：341 种 HTML Canvas/SVG 代码动画风格库（10 大系列）与无损逐帧渲 MP4/透明 WebM',
    '   - xiaocong_status / xiaocong_engine_doctor / xiaocong_engine_start / xiaocong_engine_stop / xiaocong_cache_clean',
    '   - xiaocong_capabilities / xiaocong_pack_options / xiaocong_fonts / xiaocong_fonts_install',
    '   - xiaocong_transcribe / xiaocong_srt_export：本地语音转字幕（词级时间轴）与导出 SRT',
    '   - xiaocong_trendy_koubo：【仅用于真人/数字人口播】一键「网感口播」三合一模板（trendy_red / trendy_gold / trendy_cyan）直出 mp4 或剪映草稿',
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
    '【关键防踩坑规则（AI 必须严格遵守）】',
    '1. 区分「风格」与「音色」：当用户问「有几个风格 / 有哪些风格」时，必先调 xiaocong_anim_styles_list 回答内置的 341 种代码动画视觉风格（十大系列），可顺带区分 3 套网感口播模板和 4 种配音音色，严禁只回答 4 种配音音色！',
    '2. 代码动画防丑铁律：写 HTML 代码动画前必须先调 xiaocong_anim_styles_list + xiaocong_anim_style_get(id, orientation="vertical") 读取视觉规范，严禁凭空裸写廉价暗黑聊天框。竖屏 1080×1920 左右安全边距严格 ≥72px（防左侧裁字）、顶部留白 ≥180px、底部留白 ≥380px 给字幕（动画底部别再多写重复的小总结句），每 2~4 秒只聚焦 1 个大字视觉重点。',
    '3. 代码动画字幕红线：',
    '   - 真人/数字人口播视频 → 可用 xiaocong_trendy_koubo（高级红/黑金杂志/极简白青大花字）。',
    '   - 代码动画/MG信息图视频 → 严禁套用 trendy_koubo 错落大花字！合配音加字幕时改用 xiaocong_render，并设 subtitles.style="anim_clean"（深色底动画，极简小号单行居中细白字）或 "anim_pill"（浅色/纸纹/复杂底动画，带柔黑半透明底条）。',
    '   - 真人 + 代码动画混剪 → 真人段可用网感大花字，动画插片段字幕降级为 anim_clean/anim_pill 或隐藏外挂字幕。',
    '',
    '【推荐工作流（带公司档案全闭环）】',
    '1. 先调 xiaocong_company_brief（传公司名）读取档案；若引擎离线先调 xiaocong_engine_start。',
    '2. 需要配音先调 xiaocong_voices_list + xiaocong_tts；需要素材调 xiaocong_materials_list 或 xiaocong_hotboard / xiaocong_platform_media。',
    '3. 真人口播走 xiaocong_trendy_koubo；代码动画走 xiaocong_anim_styles_list → xiaocong_anim_style_get → xiaocong_anim_render → xiaocong_render(subtitles.style="anim_clean"或"anim_pill")；轮询 xiaocong_render_status(task_id) 直到 status="done"。',
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
