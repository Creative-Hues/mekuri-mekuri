import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/**
 * 検索結果から移動したとき、見つかった文字を一時的に目立たせる(文書は変えない)。
 * editor.view.dispatch(tr.setMeta(searchHighlightKey, { from, to })) で付け、{ clear: true } で消す
 */

export const searchHighlightKey = new PluginKey<DecorationSet>('searchHighlight')

export type SearchHighlightMeta = { from: number; to: number } | { clear: true }

export const SearchHighlight = Extension.create({
  name: 'searchHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: searchHighlightKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, set) => {
            const meta = tr.getMeta(searchHighlightKey) as SearchHighlightMeta | undefined
            if (meta && 'clear' in meta) return DecorationSet.empty
            if (meta) {
              return DecorationSet.create(tr.doc, [
                Decoration.inline(meta.from, meta.to, { class: 'search-flash' }),
              ])
            }
            return set.map(tr.mapping, tr.doc)
          },
        },
        props: {
          decorations: (state) => searchHighlightKey.getState(state),
        },
      }),
    ]
  },
})
