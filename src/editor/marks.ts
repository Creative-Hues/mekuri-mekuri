import { Mark, mergeAttributes } from '@tiptap/core'
import {
  isLineStyle,
  isMarkerColor,
  isTextColor,
  type LineColorName,
  type LineStyleName,
  type MarkerColorName,
  type TextColorName,
} from './palette'

/**
 * 文字の装飾(フェーズ2)
 * - textColor:文字色
 * - marker:マーカー(文字の背景に色を塗る)
 * - underline:ライン(線の種類と色を選べる下線)
 * どれも色は色名で保存し、見た目は editor.css と base.css で決める
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textColor: {
      setTextColor: (color: TextColorName) => ReturnType
      unsetTextColor: () => ReturnType
    }
    marker: {
      setMarker: (color: MarkerColorName) => ReturnType
      unsetMarker: () => ReturnType
      /** 同じ色のマーカーがかかっていれば外し、そうでなければかける */
      toggleMarker: (color: MarkerColorName) => ReturnType
    }
    line: {
      setLine: (attrs: { style: LineStyleName; color: LineColorName }) => ReturnType
      unsetLine: () => ReturnType
      /** ラインがかかっていれば外し、そうでなければかける */
      toggleLine: (attrs: { style: LineStyleName; color: LineColorName }) => ReturnType
    }
  }
}

export const TextColor = Mark.create({
  name: 'textColor',

  addAttributes() {
    return {
      color: {
        default: 'red',
        parseHTML: (el) => {
          const v = el.getAttribute('data-text-color')
          return isTextColor(v) ? v : 'red'
        },
        renderHTML: (attrs) => ({ 'data-text-color': attrs.color }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-text-color]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'tc' }), 0]
  },

  addCommands() {
    return {
      setTextColor:
        (color) =>
        ({ commands }) =>
          commands.setMark(this.name, { color }),
      unsetTextColor:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name, { extendEmptyMarkRange: true }),
    }
  },
})

export const Marker = Mark.create({
  name: 'marker',

  addAttributes() {
    return {
      color: {
        default: 'yellow',
        parseHTML: (el) => {
          const v = el.getAttribute('data-marker')
          return isMarkerColor(v) ? v : 'yellow'
        },
        renderHTML: (attrs) => ({ 'data-marker': attrs.color }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'mark[data-marker]' }, { tag: 'mark' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['mark', mergeAttributes(HTMLAttributes, { class: 'mk' }), 0]
  },

  addCommands() {
    return {
      setMarker:
        (color) =>
        ({ commands }) =>
          commands.setMark(this.name, { color }),
      unsetMarker:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name, { extendEmptyMarkRange: true }),
      toggleMarker:
        (color) =>
        ({ editor, commands }) =>
          editor.isActive(this.name, { color })
            ? commands.unsetMark(this.name, { extendEmptyMarkRange: true })
            : commands.setMark(this.name, { color }),
    }
  },
})

/** ライン。名前は標準の下線と同じ underline にしておく(出力のときに下線として扱いやすいように) */
export const Line = Mark.create({
  name: 'underline',

  addAttributes() {
    return {
      style: {
        default: 'solid',
        parseHTML: (el) => {
          const v = el.getAttribute('data-line-style')
          return isLineStyle(v) ? v : 'solid'
        },
        renderHTML: (attrs) => ({ 'data-line-style': attrs.style }),
      },
      color: {
        default: null,
        parseHTML: (el) => {
          const v = el.getAttribute('data-line-color')
          return isTextColor(v) ? v : null
        },
        renderHTML: (attrs) => (attrs.color ? { 'data-line-color': attrs.color } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'u' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['u', mergeAttributes(HTMLAttributes, { class: 'ln' }), 0]
  },

  addCommands() {
    return {
      setLine:
        (attrs) =>
        ({ commands }) =>
          commands.setMark(this.name, attrs),
      unsetLine:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name, { extendEmptyMarkRange: true }),
      toggleLine:
        (attrs) =>
        ({ editor, commands }) =>
          editor.isActive(this.name)
            ? commands.unsetMark(this.name, { extendEmptyMarkRange: true })
            : commands.setMark(this.name, attrs),
    }
  },
})
