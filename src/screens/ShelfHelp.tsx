import { HelpPanel } from '../help/HelpPanel'
import { openOnboarding } from '../onboarding/onboarding'
import { shelfHelpSections, shelfHowTo } from './shelfButtons'

/**
 * 本棚のヘルプ:操作のしかたと、本棚のボタンの一覧。最初の使い方説明もここから開ける。
 * 一覧は画面のボタンと同じ情報(shelfButtons.tsx)から作る
 */
export function ShelfHelp({ side, mouse, onClose }: { side: boolean; mouse: boolean; onClose: () => void }) {
  return (
    <HelpPanel
      side={side}
      mouse={mouse}
      howTo={shelfHowTo(mouse)}
      sections={shelfHelpSections()}
      onClose={onClose}
      footer={
        <button
          type="button"
          className="btn btn--plain"
          onClick={() => {
            onClose()
            openOnboarding()
          }}
        >
          使い方を見る(最初の説明)
        </button>
      }
    />
  )
}
