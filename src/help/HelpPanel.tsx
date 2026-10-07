import { useEffect, type ReactNode } from 'react'
import { Icon } from '../components/Icon'
import { Glyph, buttonShortcut, forDevice, shownOn, type ButtonDef } from './buttons'

/**
 * ヘルプの一覧(ノート画面・本棚で使う)。
 * 「操作のしかた」(端末に合わせた指・マウスでの操作)と、ボタンの一覧(アイコン・名前・説明)を出す。
 * ボタンの一覧は、画面のボタンと同じ情報(ButtonDef)から作る。
 * マウスの端末(PC)ではショートカットキーも出し、タッチの端末(スマホ)ではショートカット・マウスの説明は出さない。
 * PCは右から出るパネル、スマホは下から出るシート
 */

export interface HelpSection {
  title: string
  /** part:大きな見出し(画面の上・ツールバーなど) / group:その中の小さな見出し */
  level: 'part' | 'group'
  note?: string
  items: [string, ButtonDef][]
}

export function HelpPanel({
  side,
  mouse,
  howTo,
  sections,
  footer,
  onClose,
}: {
  /** 右から出すか(PC)。false なら下から出す */
  side: boolean
  /** マウスで操作する端末か(説明とショートカットの出し分け) */
  mouse: boolean
  /** 操作のしかた(端末に合わせたもの) */
  howTo: ReactNode[]
  sections: HelpSection[]
  footer?: ReactNode
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="toc-backdrop" onClick={onClose}>
      <aside
        className={`toc help ${side ? 'toc--side' : 'toc--sheet'}`}
        aria-label="ヘルプ"
        data-device={mouse ? 'mouse' : 'touch'}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="toc-header">
          <h2>ヘルプ</h2>
          <button className="icon-btn" onClick={onClose} aria-label="閉じる" title="閉じる">
            <Icon name="close" />
          </button>
        </header>
        <div className="toc-scroll help-scroll">
          <section className="help-section">
            <h3 className="help-part">操作のしかた</h3>
            <ul className="help-howto">
              {howTo.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          </section>

          {sections.map((s) => {
            const items = s.items.filter(([, def]) => shownOn(def, mouse))
            // その端末で出ないボタンだけの見出しは出さない(見出しと説明だけの区切りはそのまま出す)
            if (items.length === 0 && s.items.length > 0) return null
            const Heading = s.level === 'part' ? 'h3' : 'h4'
            return (
              <section key={s.title} className="help-section">
                <Heading className={s.level === 'part' ? 'help-part' : 'help-group'}>{s.title}</Heading>
                {s.note && <p className="help-intro">{s.note}</p>}
                <ul className="help-list">
                  {items.map(([id, def]) => (
                    <HelpItem key={id} id={id} def={def} mouse={mouse} />
                  ))}
                </ul>
              </section>
            )
          })}

          {footer && <div className="help-footer">{footer}</div>}
        </div>
      </aside>
    </div>
  )
}

function HelpItem({ id, def, mouse }: { id: string; def: ButtonDef; mouse: boolean }) {
  const key = mouse ? buttonShortcut(def) : ''
  return (
    <li className="help-item" data-help-id={id}>
      <span className="help-glyph" aria-hidden="true">
        <Glyph glyph={def.glyph} />
      </span>
      <span className="help-text">
        <span className="help-name">{def.name}</span>
        <span className="help-desc">{forDevice(def.description, mouse)}</span>
        {def.when && <span className="help-when">{forDevice(def.when, mouse)}に出ます</span>}
        {key && (
          <span className="help-key">
            {def.shortcutNote && `${def.shortcutNote}:`}
            <kbd>{key}</kbd>
          </span>
        )}
      </span>
    </li>
  )
}
