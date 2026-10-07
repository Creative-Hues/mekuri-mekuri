import { HelpPanel } from '../../help/HelpPanel'
import { noteHelpSections, noteHowTo } from './noteButtons'

/**
 * ノート画面のヘルプ:操作のしかたと、ヘッダー・ツールバーのボタンの一覧。
 * 一覧は画面のボタンと同じ情報(noteButtons.tsx)から作る。
 * mouse:PC(マウス)ならマウスの操作とショートカット、スマホ(タッチ)なら指での操作を出す
 */
export function NoteHelp({ side, mouse, onClose }: { side: boolean; mouse: boolean; onClose: () => void }) {
  return (
    <HelpPanel side={side} mouse={mouse} howTo={noteHowTo(mouse)} sections={noteHelpSections(mouse)} onClose={onClose} />
  )
}
