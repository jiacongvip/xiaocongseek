export type MixcutVoice = {
  id: string
  name: string
  voiceId: string
  sex: '男' | '女'
  instruction: string
  recipes: string[]
}

/** Built-in emotional mixcut voices. The customer picks one by name. */
export const MIXCUT_VOICES: MixcutVoice[] = [
  {
    id: 'warm_boss',
    name: '热心老板',
    voiceId: '44',
    sex: '男',
    recipes: ['talk', 'walk'],
    instruction: '用热心老板的口吻，像在店里跟邻居说话，亲切、带点笑意，不要播音腔。',
  },
  {
    id: 'warn_friend',
    name: '避坑提醒',
    voiceId: '60',
    sex: '女',
    recipes: ['pitfall'],
    instruction: '语气急一点、真诚提醒，像朋友劝你别踩坑，句子要短，不要播音腔。',
  },
  {
    id: 'steady_pro',
    name: '稳重师傅',
    voiceId: '51',
    sex: '男',
    recipes: ['hands', 'contrast'],
    instruction: '沉稳、干活现场的口气，一句一句把事说清楚，不要喊、不要广告腔。',
  },
  {
    id: 'show_result',
    name: '带看效果',
    voiceId: '79',
    sex: '女',
    recipes: ['result'],
    instruction: '轻快、带人看做好的样子，有点小得意但不大喊，像店里的人在介绍。',
  },
]

export function pickMixcutVoice(wanted = ''): MixcutVoice | undefined {
  const key = String(wanted || '').trim()
  const lower = key.toLowerCase()
  if (!key) return undefined
  return MIXCUT_VOICES.find(item => item.id === lower || item.name === key)
}

export function voiceChoiceMenu(): string {
  return `${MIXCUT_VOICES.map(item => item.name).join(' / ')} / 用我的声音`
}
