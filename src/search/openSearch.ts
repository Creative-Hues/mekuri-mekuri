/** 全ノート検索を開く合図(本棚・ノート画面・一覧の検索ボタンから送り、App が受け取る) */
export const OPEN_SEARCH_EVENT = 'mekuri:open-search'

export function openSearch() {
  window.dispatchEvent(new Event(OPEN_SEARCH_EVENT))
}
