import { Node, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { NodeView } from '@tiptap/pm/view'
import { TextSelection } from '@tiptap/pm/state'
import { imageUrl, saveImage } from '../images/store'
import { resizeImage } from '../images/resize'
import { placeCursorAfterBlock } from './blockInsert'
import { canInsertImageAt, imagePastePlugin } from './imagePaste'

/**
 * 画像(1行として扱う)。
 * 画像そのものはデータベースの images に保存し、本文には imageId だけを入れる
 * (本文の JSON を軽く保ち、同じ画像を付箋・ページ間で動かしても中身を写さずに済むように)
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    image: {
      insertImage: (attrs: ImageAttrs) => ReturnType
    }
  }
}

export interface ImageAttrs {
  imageId: string
  width: number
  height: number
}

/** 画像の見た目。読み込むまでは画像の縦横比の枠を出しておく(行の位置がずれないように) */
class ImageView implements NodeView {
  dom: HTMLElement
  private img: HTMLImageElement

  constructor(private node: PMNode) {
    this.dom = document.createElement('figure')
    this.dom.className = 'image-block'
    this.dom.contentEditable = 'false'
    this.img = document.createElement('img')
    this.img.alt = ''
    this.img.draggable = false
    this.dom.appendChild(this.img)
    this.load()
  }

  private load() {
    const { imageId, width, height } = this.node.attrs
    if (width && height) this.img.style.aspectRatio = `${width} / ${height}`
    this.dom.classList.add('is-loading')
    void imageUrl(imageId).then((url) => {
      if (this.node.attrs.imageId !== imageId) return
      this.dom.classList.remove('is-loading')
      if (url) {
        this.img.src = url
        this.dom.classList.remove('is-missing')
      } else {
        this.img.removeAttribute('src')
        this.dom.classList.add('is-missing')
        this.dom.dataset.message = '画像が見つかりません'
      }
    })
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    const changed = node.attrs.imageId !== this.node.attrs.imageId
    this.node = node
    if (changed) this.load()
    return true
  }

  selectNode() {
    this.dom.classList.add('is-selected')
  }

  deselectNode() {
    this.dom.classList.remove('is-selected')
  }

  ignoreMutation() {
    return true
  }
}

export const ImageNode = Node.create<{
  /** ほかのアプリから貼り付け・ドロップされた画像ファイルを受け取る(imagePaste.ts) */
  onImageFiles: ((files: File[], pos: number | null) => void) | null
}>({
  name: 'image',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { onImageFiles: null }
  },

  addProseMirrorPlugins() {
    return [imagePastePlugin(() => this.options.onImageFiles ?? undefined)]
  },

  addAttributes() {
    return {
      imageId: { default: null, parseHTML: (el) => el.getAttribute('data-image-id') },
      width: { default: null, parseHTML: (el) => Number(el.getAttribute('width')) || null },
      height: { default: null, parseHTML: (el) => Number(el.getAttribute('height')) || null },
    }
  },

  // このアプリの中でのコピー・貼り付け用。ほかのアプリからの画像は、画像ファイルとして imagePaste.ts で受け取る
  parseHTML() {
    return [{ tag: 'img[data-image-id]' }]
  },

  renderHTML({ node }) {
    return [
      'img',
      { 'data-image-id': node.attrs.imageId, width: node.attrs.width, height: node.attrs.height, alt: '' },
    ]
  },

  addNodeView() {
    return ({ node }) => new ImageView(node)
  },

  addCommands() {
    return {
      insertImage:
        (attrs) =>
        ({ chain }) =>
          chain()
            .insertContent({ type: this.name, attrs })
            .command(({ tr }) => {
              placeCursorAfterBlock(tr)
              return true
            })
            .run(),
    }
  },
})

/** 画像ファイルを縮小して保存する。読めなかったファイルは数だけ返す */
async function prepareImages(files: File[]): Promise<{ images: ImageAttrs[]; failed: number }> {
  const images: ImageAttrs[] = []
  let failed = 0
  for (const file of files) {
    try {
      const img = await resizeImage(file)
      images.push({ imageId: await saveImage(img), width: img.width, height: img.height })
    } catch (e) {
      console.error(e)
      failed++
    }
  }
  return { images, failed }
}

/**
 * 画像をまとめて入れる(1回の変更にするので、「元に戻す」1回で全部戻る)。
 * pos を指定するとその位置(ドロップした所)、なければカーソルの位置
 */
export function insertImages(editor: Editor, images: ImageAttrs[], pos: number | null = null): boolean {
  if (images.length === 0 || editor.isDestroyed) return false
  let chain = editor.chain().focus()
  if (pos !== null) {
    // ドロップした位置の近くの、文字を入れられる所にカーソルを置く
    chain = chain.command(({ tr }) => {
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size))))
      return true
    })
  }
  for (const attrs of images) chain = chain.insertImage(attrs)
  return chain.run()
}

/** 画像を入れるときに、ノート画面から受け取る処理 */
export interface ImageInsertUi {
  /** 「元に戻す」の区切り */
  closeGroup: () => void
  alert: (message: string) => Promise<void>
}

/**
 * 画像ファイル(端末から選んだもの・貼り付け・ドロップ)を縮小・保存して入れる。
 * 表の中には入れない
 */
export async function insertImageFiles(
  editor: Editor,
  files: File[],
  ui: ImageInsertUi,
  pos: number | null = null,
): Promise<void> {
  if (editor.isDestroyed || files.length === 0) return
  if (!canInsertImageAt(editor.state, pos ?? editor.state.selection.from)) {
    await ui.alert('表の中には画像を入れられません。表の外に入れてください。')
    return
  }
  const { images, failed } = await prepareImages(files)
  if (editor.isDestroyed) return
  // 縮小している間に文章が変わっていたら、位置がずれるのでカーソルの位置に入れる
  const at = pos !== null && pos <= editor.state.doc.content.size && canInsertImageAt(editor.state, pos) ? pos : null
  ui.closeGroup()
  insertImages(editor, images, at)
  ui.closeGroup()
  if (failed > 0) {
    await ui.alert(
      files.length === 1
        ? '画像を入れられませんでした。別の画像で試してください。'
        : `${failed}枚の画像を入れられませんでした。別の画像で試してください。`,
    )
  }
}
