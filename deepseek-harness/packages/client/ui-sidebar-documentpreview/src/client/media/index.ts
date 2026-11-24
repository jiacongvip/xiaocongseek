/** Builtin video and audio metadata and keyed document-body registration. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '../index.ts'
import type { DocumentPreviewDefinition } from '../document/registry.ts'
import { MediaBody } from './MediaBody.tsx'
import { MEDIA_EXTENSIONS } from './MediaBody.tsx'
import { en, ja, es, fr, de, ru, pt, zh } from './locales.ts'

/** Media implementation identity, shared by metadata and the keyed slot. */
export const MEDIA_BODY_ID = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/media'

export { MEDIA_EXTENSIONS, mediaKind } from './MediaBody.tsx'

/**
 * Describe the builtin media renderer independently from its keyed body slot.
 * @param title - locale-owned implementation name.
 * @returns metadata for native video and audio playback.
 */
export function mediaBodyDefinition(title: () => string): DocumentPreviewDefinition {
  return {
    id: MEDIA_BODY_ID,
    extensions: MEDIA_EXTENSIONS,
    binaryExtensions: MEDIA_EXTENSIONS,
    priority: 'builtin',
    title,
    loading: 'renderer',
    wrap: false,
  }
}

/**
 * Register the media dictionary, metadata, and body with reversible effects.
 * @param ctx - owning plugin context.
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind('sidebarMedia')
  ctx.effect(() => ctx.locale.register('sidebarMedia', { zh, en, ja, es, fr, de, ru, pt }), 'document-media: dictionaries')
  ctx.effect(() => ctx.documentPreviews.register(mediaBodyDefinition(() => t('title'))), 'document-media: metadata')
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register({
    name: 'sidebar.right.tab.document', key: MEDIA_BODY_ID, locale: 'sidebarMedia',
  }, MediaBody)), 'document-media: body')
}
