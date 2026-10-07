import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import type { NoteDesign } from '../../db/db'
import { Icon } from '../../components/Icon'
import { Cover } from '../../components/Cover'
import { COVER_FONTS, COVER_LAYOUTS, COVER_PATTERNS, patternInk } from '../../design/cover'
import { normalizeDesign } from '../../design/defaults'
import { BORDER_COLORS, BORDER_WIDTHS, COVER_COLORS, PAPER_COLORS, coverColor } from '../../design/palette'

type Tab = 'cover' | 'paper'

/**
 * ノートのデザイン(表紙・紙の背景色・縁)。
 * 選ぶとすぐノートに反映される(元に戻すで戻せる)。
 * PCは右から出るパネル、スマホは下から出るシート。紙の色が見えるよう、後ろは暗くしない
 */
export function DesignPanel({
  title,
  design: raw,
  side,
  onChange,
  onClose,
}: {
  title: string
  design: NoteDesign
  side: boolean
  onChange: (next: NoteDesign) => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('cover')
  const design = normalizeDesign(raw)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const setCover = (patch: Partial<NoteDesign['cover']>) => onChange({ ...design, cover: { ...design.cover, ...patch } })
  const setBorder = (patch: Partial<NoteDesign['border']>) =>
    onChange({ ...design, border: { ...design.border, ...patch } })
  /** 見本の表紙(1か所だけ変えたもの) */
  const sample = (patch: Partial<NoteDesign['cover']>): NoteDesign => ({ ...design, cover: { ...design.cover, ...patch } })
  const tone = coverColor(design.cover.color)!.tone

  return (
    <div className="toc-backdrop design-backdrop" onClick={onClose}>
      <aside
        className={`toc design ${side ? 'toc--side' : 'toc--sheet'}`}
        aria-label="デザイン"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="toc-header">
          <h2>デザイン</h2>
          <button className="icon-btn" onClick={onClose} aria-label="閉じる" title="閉じる">
            <Icon name="close" />
          </button>
        </header>
        <div className="segmented design-tabs" role="tablist">
          {(
            [
              ['cover', '表紙'],
              ['paper', '紙と縁'],
            ] as const
          ).map(([t, label]) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={`segmented-btn${tab === t ? ' is-selected' : ''}`}
              onClick={() => setTab(t)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="toc-scroll design-scroll">
          {tab === 'cover' ? (
            <>
              <div className="design-preview">
                <span className="design-preview-cover">
                  <Cover title={title} design={design} />
                </span>
              </div>

              <DesignGroup label="色">
                {COVER_COLORS.map((c) => (
                  <ColorChoice
                    key={c.name}
                    label={c.label}
                    hex={c.hex}
                    selected={design.cover.color === c.name}
                    onClick={() => setCover({ color: c.name })}
                  />
                ))}
              </DesignGroup>

              <DesignGroup label="柄">
                {COVER_PATTERNS.map((p) => (
                  <button
                    key={p.name}
                    className={`design-tile${design.cover.pattern === p.name ? ' is-selected' : ''}`}
                    aria-pressed={design.cover.pattern === p.name}
                    title={p.label}
                    onClick={() => setCover({ pattern: p.name })}
                  >
                    <span
                      className="design-tile-pattern"
                      style={
                        {
                          backgroundColor: coverColor(design.cover.color)!.hex,
                          ...p.css(patternInk(tone)),
                        } as CSSProperties
                      }
                    />
                    <span className="design-tile-label">{p.label}</span>
                  </button>
                ))}
              </DesignGroup>

              <DesignGroup label="文字の配置">
                {COVER_LAYOUTS.map((l) => (
                  <CoverChoice
                    key={l.name}
                    label={l.label}
                    title={title}
                    design={sample({ layout: l.name })}
                    selected={design.cover.layout === l.name}
                    onClick={() => setCover({ layout: l.name })}
                  />
                ))}
              </DesignGroup>

              <DesignGroup label="書体">
                {COVER_FONTS.map((f) => (
                  <CoverChoice
                    key={f.name}
                    label={f.label}
                    title={title}
                    design={sample({ font: f.name })}
                    selected={design.cover.font === f.name}
                    onClick={() => setCover({ font: f.name })}
                  />
                ))}
              </DesignGroup>
              <p className="design-note">書体は端末に入っているものを使うため、端末によって見た目が少し変わります。</p>
            </>
          ) : (
            <>
              <DesignGroup label="紙の背景色">
                <button
                  className={`swatch swatch--wide${design.paper === null ? ' is-selected' : ''}`}
                  aria-pressed={design.paper === null}
                  onClick={() => onChange({ ...design, paper: null })}
                >
                  指定なし
                </button>
                {PAPER_COLORS.map((c) => (
                  <ColorChoice
                    key={c.name}
                    label={c.label}
                    hex={c.hex}
                    selected={design.paper === c.name}
                    onClick={() => onChange({ ...design, paper: c.name })}
                  />
                ))}
              </DesignGroup>
              <p className="design-note">「指定なし」はアプリの明るさ(ライト/ダーク)に合わせます。</p>

              <DesignGroup label="縁の太さ">
                <div className="segmented design-widths" role="radiogroup" aria-label="縁の太さ">
                  {BORDER_WIDTHS.map((w) => (
                    <button
                      key={w.name}
                      role="radio"
                      aria-checked={design.border.width === w.name}
                      className={`segmented-btn${design.border.width === w.name ? ' is-selected' : ''}`}
                      onClick={() => setBorder({ width: w.name })}
                    >
                      {w.label}
                    </button>
                  ))}
                </div>
              </DesignGroup>

              <DesignGroup label="縁の色">
                {BORDER_COLORS.map((c) => (
                  <ColorChoice
                    key={c.name}
                    label={c.label}
                    hex={c.hex}
                    selected={design.border.color === c.name}
                    disabled={design.border.width === 'none'}
                    onClick={() => setBorder({ color: c.name, width: design.border.width === 'none' ? 'thin' : design.border.width })}
                  />
                ))}
              </DesignGroup>
            </>
          )}
        </div>
      </aside>
    </div>
  )
}

function DesignGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="design-group">
      <h3>{label}</h3>
      <div className="design-choices">{children}</div>
    </section>
  )
}

function ColorChoice(props: {
  label: string
  hex: string
  selected: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      className={`swatch${props.selected ? ' is-selected' : ''}${props.disabled ? ' is-dim' : ''}`}
      aria-label={props.label}
      aria-pressed={props.selected}
      title={props.label}
      onClick={props.onClick}
    >
      <span className="swatch-fill" style={{ background: props.hex }} />
    </button>
  )
}

function CoverChoice(props: {
  label: string
  title: string
  design: NoteDesign
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      className={`design-tile${props.selected ? ' is-selected' : ''}`}
      aria-pressed={props.selected}
      title={props.label}
      onClick={props.onClick}
    >
      <span className="design-tile-cover">
        <Cover title={props.title} design={props.design} />
      </span>
      <span className="design-tile-label">{props.label}</span>
    </button>
  )
}
