import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'

/**
 * ほかのアプリからの画像の貼り付け(PC のスクリーンショットなど)と、ドラッグ&ドロップでの画像の挿入。
 * 本文のエディタだけで使う(付箋には画像を入れない)。
 * 画像の縮小・保存・挿入は時間がかかり、ダイアログも出すので、ノート画面側(onImageFiles)で行う
 */

/** 貼り付け・ドロップの中身のうち、ここで見る部分(テストで偽物を渡せるように) */
export interface TransferLike {
  files: ArrayLike<File>
  getData(format: string): string
}

/** HTML に画像以外の文字があるか */
function htmlHasText(html: string): boolean {
  if (!html.trim()) return false
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return !!doc.body.textContent?.trim()
}

/**
 * 画像として入れるファイルを取り出す(計算だけの関数)。
 * 貼り付けで文字も一緒に入っているとき(Word・Excel などからのコピー)は、文字の貼り付けを優先して画像は使わない。
 * ブラウザの「画像をコピー」のように、HTML が画像だけ(文字なし)のときは画像ファイルを使う
 */
export function pickImageFiles(data: TransferLike | null, kind: 'paste' | 'drop'): File[] {
  if (!data) return []
  const files = Array.from(data.files).filter((f) => f.type.startsWith('image/'))
  if (files.length === 0) return []
  if (kind === 'paste') {
    if (data.getData('text/plain').trim()) return []
    if (htmlHasText(data.getData('text/html'))) return []
  }
  return files
}

/** その位置に画像を入れられるか(表の中には入れない) */
export function canInsertImageAt(state: EditorState, pos: number): boolean {
  const $pos = state.doc.resolve(Math.max(0, Math.min(pos, state.doc.content.size)))
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.name === 'table') return false
  }
  return true
}

/**
 * 画像ファイルが来たら onImageFiles に渡すプラグイン。
 * pos:ドロップした位置(貼り付けは null = カーソルの位置)
 */
export function imagePastePlugin(onImageFiles: () => ((files: File[], pos: number | null) => void) | undefined) {
  return new Plugin({
    key: new PluginKey('imagePaste'),
    props: {
      handlePaste: (_view, event) => {
        const handler = onImageFiles()
        const files = pickImageFiles(event.clipboardData, 'paste')
        if (!handler || files.length === 0) return false
        event.preventDefault()
        handler(files, null)
        return true
      },
      handleDrop: (view, event) => {
        const handler = onImageFiles()
        const files = pickImageFiles(event.dataTransfer, 'drop')
        if (!handler || files.length === 0) return false
        event.preventDefault()
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
        handler(files, at ? at.pos : null)
        return true
      },
    },
  })
}
