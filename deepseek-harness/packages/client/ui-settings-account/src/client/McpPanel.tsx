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
    `你已接入本机 Xiaocongseek 视频剪辑 MCP 服务（服务名：${serverName}，地址：${url}）。`,
    `当用户要求剪辑视频、加字幕、去气口、配音乐、套模板、生成数字人或封面时，优先调用 xiaocong_* MCP 工具完成，不要手写复杂 ffmpeg 命令，也不要把本地视频上传到第三方云端。`,
    '',
    '【核心能力与工具清单】',
    '1. 公司空间与公司档案（写文案/剪片前优先读）：',
    '   - xiaocong_company_list：列出所有公司及各家完整档案（id、名称、brief）',
    '   - xiaocong_company_brief：按公司名称或 ID 读取完整档案（文案底稿：身份/卖点/受众/口吻/禁忌/品牌事实/痛点/证据/CTA/关键词/样稿；剪辑规范：videoFormat/editStyle/visualStyle/audioStyle/outroTemplate；外加偏好音色/BGM 与知识库资料摘要）',
    '   - xiaocong_company_select：按公司名或 ID 切换当前工作公司',
    '   - xiaocong_company_brief_update：补充或修改某家公司的文案/剪辑档案字段',
    '   - xiaocong_materials_list(space?) / xiaocong_works_list(space?)：按公司 ID 查该公司的素材库与成片库',
    '2. 环境与资源查询：',
    '   - xiaocong_status / xiaocong_engine_doctor：查剪辑引擎与环境是否就绪',
    '   - xiaocong_capabilities：查看全部可用工具、样式、音效、模板清单',
    '   - xiaocong_media_list / xiaocong_templates / xiaocong_recipes / xiaocong_fonts：查看素材、模板、出片配方与字体',
    '3. 字幕与转写：',
    '   - xiaocong_transcribe：对本地视频做语音转写（支持词级时间轴）',
    '   - xiaocong_srt_export：导出当前工程 SRT 字幕',
    '4. 剪辑、网感口播与直接渲染出片（推荐）：',
    '   - xiaocong_trendy_koubo：一键按「网感口播」高颜值模板（trendy_red 高级红 / trendy_gold 黑金杂志 / trendy_cyan 极简白青）直出 mp4（双行反色标题 + 思源粗宋中英双语错落字幕 + 关键词放大弹动 + 金句缩放 + BGM）',
    '   - xiaocong_template_apply：套用模板到当前工程',
    '   - xiaocong_preview_range：快速渲染指定时间区间预览',
    '   - xiaocong_render：提交自定义配方直接渲染成 mp4（返回 task_id，完成后自动入成片库）',
    '   - xiaocong_render_status：传 task_id 轮询渲染进度与成片路径，直到 status="done"',
    '   - xiaocong_render_cancel / xiaocong_render_batch_status：取消渲染或查批量队列',
    '5. 工程管理：',
    '   - xiaocong_project_list / xiaocong_project_load / xiaocong_project_save / xiaocong_project_saveas',
    '6. 素材采集 / 数字人 / 生图：',
    '   - xiaocong_media_ingest + xiaocong_media_ingest_status：下载抖音等外部视频入库',
    '   - xiaocong_digital_human_defaults + xiaocong_digital_human_create（model 须以 xdh- 开头）+ xiaocong_digital_human_task',
    '   - xiaocong_image_models + xiaocong_image_create + xiaocong_image_task',
    '',
    '【推荐工作流（带公司档案 4 步出片）】',
    '1. 先调 xiaocong_company_brief（传公司名如 name="测试公司"，或先 xiaocong_company_list 查看全部公司）拿到公司档案，必要时调 xiaocong_company_select 切换过去。',
    '2. 调 xiaocong_materials_list(space=公司ID) 或 xiaocong_media_list 获取素材路径；若需按口播内容卡点先调 xiaocong_transcribe。',
    '3. 严格按公司档案里的定位、卖点、口吻和禁忌组织口播/花字/字幕，调 xiaocong_render 提交配方直出 mp4。',
    '4. 轮询 xiaocong_render_status(task_id) 直到 status="done"，将成片路径回报给用户。',
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
