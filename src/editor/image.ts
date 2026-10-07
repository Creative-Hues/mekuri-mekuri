import { Node, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { NodeView } from '@tiptap/pm/view'
import { imageUrl, saveImage } from '../images/store'
import { resizeImage } from '../images/resize'
import { placeCursorAfterBlock } from './blockInsert'

/**
 * 画像(1行として扱う)。
 * 画像そのものはデータベースの images に保存し、本文には imageId だけを入れる
 * (本文の JSON を軽く保ち、同じ画像を付箋・ページ間で動かしても中身を写さずに済むように)
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    image: {
      insertImage: (attrs: { imageId: string; width: number; height: number }) => ReturnType
    }
  }
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

export const ImageNode = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      imageId: { default: null, parseHTML: (el) => el.getAttribute('data-image-id') },
      width: { default: null, parseHTML: (el) => Number(el.getAttribute('width')) || null },
      height: { default: null, parseHTML: (el) => Number(el.getAttribute('height')) || null },
    }
  },

  // コピー・貼り付けはこのアプリの中だけで使う(ほかのアプリの画像の貼り付けは対象外)
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

/** 端末から選んだ画像を縮小して保存し、カーソルの位置に入れる */
export async function insertImageFile(editor: Editor, file: File): Promise<void> {
  const img = await resizeImage(file)
  const imageId = await saveImage(img)
  if (editor.isDestroyed) return
  editor.chain().focus().insertImage({ imageId, width: img.width, height: img.height }).run()
}
