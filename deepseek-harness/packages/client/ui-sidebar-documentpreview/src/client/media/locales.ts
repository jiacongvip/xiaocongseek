/** Locale-owned media renderer labels and status text. */
export const zh = {
  title: '媒体',
  preview: '媒体预览：{name}',
  loading: '文档渲染中...',
  failed: '无法播放这个文件',
  unsupported: '媒体预览需要文件的本机路径',
} satisfies Record<string, string>

/** Media renderer dictionary keys. */
export type MediaPreviewKey = keyof typeof zh

/** English dictionary with the same keys as the Chinese dictionary. */
export const en = {
  title: 'Media',
  preview: 'Media preview: {name}',
  loading: 'Rendering document...',
  failed: 'This file could not be played.',
  unsupported: 'Media preview needs the file\'s native path.',
} satisfies Record<MediaPreviewKey, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Media preview selection, accessible name, and status text. */
    sidebarMedia: MediaPreviewKey
  }
}

/** Japanese copy, checked against the English keys. */
export const ja = {
  title: 'メディア',
  preview: 'メディアプレビュー: {name}',
  loading: 'ドキュメントをレンダリング中...',
  failed: 'このファイルを再生できませんでした。',
  unsupported: 'メディアプレビューにはファイルのネイティブパスが必要です。',
} satisfies Record<keyof typeof en, string>

/** Spanish dictionary, checked against the English keys. */
export const es = {
  title: 'Medios',
  preview: 'Vista previa de medios: {name}',
  loading: 'Representando documento...',
  failed: 'No se pudo reproducir este archivo.',
  unsupported: 'La vista previa de medios necesita la ruta nativa del archivo.',
} satisfies Record<keyof typeof en, string>

/** French dictionary, checked against the English keys. */
export const fr = {
  title: 'Média',
  preview: 'Aperçu média : {name}',
  loading: 'Rendu du document...',
  failed: 'Ce fichier n\'a pas pu être lu.',
  unsupported: 'L\'aperçu média a besoin du chemin natif du fichier.',
} satisfies Record<keyof typeof en, string>

/** German dictionary, checked against the English keys. */
export const de = {
  title: 'Medien',
  preview: 'Medienvorschau: {name}',
  loading: 'Dokument wird gerendert...',
  failed: 'Diese Datei konnte nicht wiedergegeben werden.',
  unsupported: 'Die Medienvorschau benötigt den nativen Dateipfad.',
} satisfies Record<keyof typeof en, string>

/** Russian dictionary, checked against the English keys. */
export const ru = {
  title: 'Медиа',
  preview: 'Предварительный просмотр медиа: {name}',
  loading: 'Оформление документа...',
  failed: 'Этот файл не удалось воспроизвести.',
  unsupported: 'Для предварительного просмотра медиа нужен собственный путь к файлу.',
} satisfies Record<keyof typeof en, string>

/** Portuguese dictionary, checked against the English keys. */
export const pt = {
  title: 'Mídia',
  preview: 'Pré-visualização de mídia: {name}',
  loading: 'Renderizando documento...',
  failed: 'Não foi possível reproduzir este arquivo.',
  unsupported: 'A pré-visualização de mídia precisa do caminho nativo do arquivo.',
} satisfies Record<keyof typeof en, string>
