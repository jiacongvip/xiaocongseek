/** User-message fence for cited digital-human videos. */
import type { UserTextRule } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { parseDigitalHumanCiteFence } from './digital-human-chat-send.ts'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface UserTextDataMap {
    xdh: {
      readonly videos: readonly {
        readonly task_id: string
        readonly avatar_name: string
        readonly video_url: string
        readonly cover_url: string
        readonly text: string
      }[]
    }
  }
}

/** Match `<<<xdh ... >>>` fences and replace them with in-bubble video nodes. */
export const digitalHumanCiteRule: UserTextRule<'xdh'> = {
  id: 'xdh',
  order: 5,
  match(text, from) {
    const hit = parseDigitalHumanCiteFence(text, from)
    if (!hit) return undefined
    return {
      id: 'xdh',
      start: hit.start,
      end: hit.end,
      data: { videos: hit.videos },
    }
  },
}
