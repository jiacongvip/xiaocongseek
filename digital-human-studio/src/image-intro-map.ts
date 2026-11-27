/** Map local styled-text entrance ids to Xiaocongcut CapCut_Intro_type names that this build supports. */

export const KNOWN_IMAGE_INTRO_TYPES = [
  'Fade_In',
  'Zoom_1',
  'Rock_Vertically',
  'Slide_Down',
  'Slide_Up',
  'Slide_Right',
  'Slide_Left',
  'Rotate',
  'Flame_Risen',
  'Rotation_Opening',
  'Retro_Fadein_2',
  'Retro_Fadein',
  'Screen_Wipe',
  'RGB_Scanlines',
  'Zoom_2',
  'Zoom_Out',
  'Zoom_In',
  'Shake_3',
  'CRT_Bands',
  'Vibrating_Panels',
  'Swing_Top_Right',
  'Anime_Frame',
  'Rock_Horizontally',
  'Gray_Mask',
  'Shake_1',
  'Spin_Up_2',
  'Whirl',
  'Mini_Zoom',
  'Spin_Up_1',
  'Swing_Bottom',
  'Swing_Right',
  'Swing_Bottom_Left',
  'Flip',
  'Shake_2',
  'Blinds',
  'Swing_Bottom_Right',
  'Puzzle',
  'Swing_Top_Left',
  'Shake_Down',
  'Swing',
  'Wiper',
  'Roll_Right',
  'Spin_Left',
] as const

export type KnownImageIntro = (typeof KNOWN_IMAGE_INTRO_TYPES)[number]

/** Entrances that only affect local preview mp4 and intentionally send NO draft intro. */
export const PREVIEW_ONLY_ENTRANCES = ['none'] as const

/**
 * Local entrance → CapCut image intro.
 * - pop: Pop_Up is NOT in this Xiaocongcut build; Mini_Zoom is the nearest supported pop-like intro.
 * - Never silently omit animation while claiming one was applied.
 */
export const ENTRANCE_TO_IMAGE_INTRO: Record<string, KnownImageIntro | null> = {
  none: null,
  fade_in: 'Fade_In',
  slide_up: 'Slide_Up',
  pop: 'Mini_Zoom',
}

export type ResolveImageIntroResult =
  | {
      ok: true
      intro?: KnownImageIntro
      requestedEntrance?: string
      requestedIntro?: string
      mappedFrom?: string
      note?: string
    }
  | {
      ok: false
      error: string
      unsupported: string
      supported: readonly string[]
      requestedEntrance?: string
      requestedIntro?: string
    }

export function resolveImageIntroForDraft(input: {
  entrance?: string
  intro_animation?: string
}): ResolveImageIntroResult {
  const supported = KNOWN_IMAGE_INTRO_TYPES
  const explicit = input.intro_animation?.trim()
  if (explicit) {
    if ((supported as readonly string[]).includes(explicit)) {
      return { ok: true, intro: explicit as KnownImageIntro, requestedIntro: explicit }
    }
    return {
      ok: false,
      error: `图片入场动画「${explicit}」不被当前本机 Xiaocongcut/CapCut_Intro_type 支持；不会静默改成静态图。`,
      unsupported: explicit,
      supported,
      requestedIntro: explicit,
      requestedEntrance: input.entrance,
    }
  }

  const entrance = String(input.entrance || 'fade_in').trim() || 'fade_in'
  if (entrance === 'none') {
    return {
      ok: true,
      requestedEntrance: entrance,
      note: 'entrance=none：草稿不附加图片入场动画（预览亦为静态）。',
    }
  }
  if (!(entrance in ENTRANCE_TO_IMAGE_INTRO)) {
    return {
      ok: false,
      error: `未知 entrance「${entrance}」。支持: none|fade_in|slide_up|pop`,
      unsupported: entrance,
      supported: ['none', 'fade_in', 'slide_up', 'pop'],
      requestedEntrance: entrance,
    }
  }
  const mapped = ENTRANCE_TO_IMAGE_INTRO[entrance]
  if (!mapped) {
    return { ok: true, requestedEntrance: entrance }
  }
  const note =
    entrance === 'pop'
      ? 'pop 在本机 Xiaocongcut 无 Pop_Up；已映射为支持的 Mini_Zoom（非静态）。'
      : entrance === 'slide_up'
        ? 'slide_up 映射为 Slide_Up（本机构建无 Fly_In）。'
        : undefined
  return {
    ok: true,
    intro: mapped,
    requestedEntrance: entrance,
    mappedFrom: entrance === 'pop' ? 'Pop_Up(unsupported)→Mini_Zoom' : entrance,
    note,
  }
}
