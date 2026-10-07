import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import type { NoteDesign } from '../../db/db'
import { Icon } from '../../components/Icon'
import { Cover } from '../../components/Cover'
import {
  BODY_FONTS,
  COVER_FONTS,
  COVER_LAYOUTS,
  COVER_PATTERNS,
  COVER_TEXT_COLORS,
  PATTERN_SCALES,
  bodyFontKind,
  fontKindFamily,
  patternScale,
  subColorInk,
} from '../../design/cover'
import { normalizeDesign } from '../../design/defaults'
import {
  BORDER_COLORS,
  BORDER_WIDTHS,
  COVER_COLORS,
  PAPER_COLORS,
  SUB_COLORS,
  SUB_COLOR_AUTO,
  coverColor,
} from '../../design/palette'

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
  // 柄の見本:今のベース色・サブ色・大きさで描く
  const ink = subColorInk(design.cover.subColor, coverColor(design.cover.color)!.tone)
  const scale = patternScale(design.cover.patternScale)!.scale

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

        {/* 表紙の見本は上に固定し、選択肢だけをスクロールする(選びながら見本を見られるように) */}
        {tab === 'cover' && (
          <div className="design-preview">
            <span className="design-preview-cover">
              <Cover title={title} design={design} />
            </span>
          </div>
        )}

        <div className="toc-scroll design-scroll">
          {tab === 'cover' ? (
            <>

              <DesignGroup label="ベース色">
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

              <DesignGroup label="サブ色(柄の色)">
                <button
                  className={`swatch swatch--wide${design.cover.subColor === SUB_COLOR_AUTO ? ' is-selected' : ''}`}
                  aria-pressed={design.cover.subColor === SUB_COLOR_AUTO}
                  onClick={() => setCover({ subColor: SUB_COLOR_AUTO })}
                >
                  なじむ色
                </button>
                {SUB_COLORS.map((c) => (
                  <ColorChoice
                    key={c.name}
                    label={c.label}
                    hex={c.hex}
                    selected={design.cover.subColor === c.name}
                    disabled={design.cover.pattern === 'plain'}
                    onClick={() => setCover({ subColor: c.name })}
                  />
                ))}
              </DesignGroup>
              <p className="design-note">「なじむ色」は、ベース色に合わせた薄い色で柄を描きます。</p>

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
                      data-color={design.cover.color}
                      style={
                        {
                          backgroundColor: coverColor(design.cover.color)!.hex,
                          ...p.css(ink, scale),
                        } as CSSProperties
                      }
                    />
                    <span className="design-tile-label">{p.label}</span>
                  </button>
                ))}
              </DesignGroup>

              <DesignGroup label="柄の大きさ">
                <div className="segmented design-widths" role="radiogroup" aria-label="柄の大きさ">
                  {PATTERN_SCALES.map((s) => (
                    <button
                      key={s.name}
                      role="radio"
                      aria-checked={design.cover.patternScale === s.name}
                      className={`segmented-btn${design.cover.patternScale === s.name ? ' is-selected' : ''}`}
                      disabled={design.cover.pattern === 'plain'}
                      onClick={() => setCover({ patternScale: s.name })}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
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

              <DesignGroup label="タイトルの文字色">
                {COVER_TEXT_COLORS.map((c) => (
                  <CoverChoice
                    key={c.name}
                    label={c.label}
                    title={title}
                    design={sample({ textColor: c.name })}
                    selected={design.cover.textColor === c.name}
                    onClick={() => setCover({ textColor: c.name })}
                  />
                ))}
              </DesignGroup>
              <p className="design-note">
                「自動」は表紙の色に合わせて白か濃い色にします。柄の上の文字には、読みやすいよう薄い影が付きます。
              </p>

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

              <DesignGroup label="本文の書体">
                {BODY_FONTS.map((f) => {
                  const kind = f.name === 'cover' ? bodyFontKind({ ...design, bodyFont: 'cover' }) : f.name
                  return (
                    <button
                      key={f.name}
                      className={`design-tile${design.bodyFont === f.name ? ' is-selected' : ''}`}
                      aria-pressed={design.bodyFont === f.name}
                      title={f.label}
                      onClick={() => onChange({ ...design, bodyFont: f.name })}
                    >
                      <span className="design-tile-font" style={{ fontFamily: fontKindFamily(kind) }}>
                        あア
                      </span>
                      <span className="design-tile-label">{f.label}</span>
                    </button>
                  )
                })}
              </DesignGroup>
              <p className="design-note">
                本文には書体の種類(ゴシック・明朝・丸ゴシック)だけを使い、太さや字間は表紙だけに使います。
                書体は端末に入っているものを使うため、端末によって見た目が少し変わります。
              </p>
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
