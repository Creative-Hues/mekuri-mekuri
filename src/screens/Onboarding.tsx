import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon, type IconName } from '../components/Icon'
import { BACKUP_MOVE_NOTICE } from '../content/notices'
import { useLayoutMode } from '../layout/useLayoutMode'

/**
 * 初回の使い方説明。カードを左右にめくって読む(スワイプ・ボタン・← → キー)。
 * 新しく使い始める人に1回だけ出し、設定画面の「使い方を見る」からいつでも見直せる
 */

interface Slide {
  icon: IconName
  title: string
  body: ReactNode
}

/**
 * カード。mouse:PC(マウス)向けの説明にするか。スマホ(タッチ)では指での操作だけを書き、
 * ショートカットキーやマウスの説明は出さない
 */
export const onboardingSlides = (mouse: boolean): Slide[] => [
  {
    icon: 'book',
    title: 'めくりめくりへようこそ',
    body: (
      <p>
        書く・まとめる・見返すためのシンプルなノートです。ノートは本棚に並び、中のページを左右にめくって使います。
      </p>
    ),
  },
  {
    icon: 'pages',
    title: 'ノートとページ',
    body: (
      <>
        <p>本棚の「新しいノート」からノートを作ります。ページは左右に増やせます。</p>
        <p>
          {mouse
            ? 'ページは、左右の矢印のボタンかキーボードの ← → でめくります。'
            : 'ページは、左右にスワイプしてめくります。'}
        </p>
      </>
    ),
  },
  {
    icon: 'edit',
    title: '書く',
    body: mouse ? (
      <>
        <p>見出し・リスト・文字の色・マーカー・表・画像・リンク・付箋は、タイトルの下のツールバーから入れられます。</p>
        <p>
          ボタンにマウスを乗せると名前が出ます。ショートカットキーも使えます(一覧は設定画面にあります)。ボタンの説明は、画面右上の
          <Icon name="help" size={16} />(ヘルプ)で見られます。
        </p>
      </>
    ) : (
      <>
        <p>見出し・リスト・文字の色・マーカー・表・画像・リンク・付箋は、画面の下のツールバーから入れられます。書いているときは、キーボードのすぐ上に出ます。</p>
        <p>
          ボタンを長押しすると名前が出ます。ボタンの説明は、画面右上の
          <Icon name="help" size={16} />(ヘルプ)で見られます。
        </p>
      </>
    ),
  },
  {
    icon: 'grip',
    title: mouse ? '並び替えはドラッグで' : '並び替えは ≡ を動かして',
    body: mouse ? (
      <p>
        ページ・行・付箋・本棚のノートは、つまみ(<Icon name="grip" size={16} />
        )をドラッグして並び替えます。行のつまみは、マウスを乗せた行の左に出ます。
      </p>
    ) : (
      <p>
        ページ・行・付箋・本棚のノートは、つまみ(<Icon name="grip" size={16} />
        )を押したまま動かして並び替えます。行のつまみは、カーソルのある行の左に出ます。
      </p>
    ),
  },
  {
    icon: 'download',
    title: 'データとバックアップ',
    body: (
      <>
        <p>ノートはこの端末の中だけに保存され、外部には送られません。端末の故障などに備えて、ときどき設定画面からバックアップしてください。</p>
        <p>{BACKUP_MOVE_NOTICE}</p>
      </>
    ),
  },
]

/** これ以上横に動かしたらめくる(px) */
const SWIPE = 50

export function Onboarding({ onClose }: { onClose: () => void }) {
  // 端末に合わせた説明(PC はマウス、スマホは指での操作)
  const SLIDES = onboardingSlides(useLayoutMode().toolbarTop)
  const [index, setIndex] = useState(0)
  const last = index === SLIDES.length - 1
  const slide = SLIDES[index]
  const start = useRef<{ x: number; y: number } | null>(null)
  const nextRef = useRef<HTMLButtonElement>(null)

  const go = (dir: 1 | -1) => setIndex((i) => Math.min(SLIDES.length - 1, Math.max(0, i + dir)))

  useEffect(() => {
    nextRef.current?.focus()
  }, [index])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="onboarding" role="dialog" aria-modal="true" aria-label="使い方">
      <div
        className="onboarding-card"
        onPointerDown={(e) => {
          start.current = { x: e.clientX, y: e.clientY }
        }}
        onPointerUp={(e) => {
          const s = start.current
          start.current = null
          if (!s) return
          const dx = e.clientX - s.x
          // 縦のスクロールと区別する
          if (Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(e.clientY - s.y)) go(dx < 0 ? 1 : -1)
        }}
      >
        <button type="button" className="onboarding-skip" onClick={onClose}>
          {last ? '閉じる' : 'スキップ'}
        </button>
        <div className="onboarding-icon">
          <Icon name={slide.icon} size={40} />
        </div>
        <h2 className="onboarding-title">{slide.title}</h2>
        <div className="onboarding-body" aria-live="polite">
          {slide.body}
        </div>
        <div className="onboarding-dots" aria-label={`${index + 1} / ${SLIDES.length}`}>
          {SLIDES.map((s, i) => (
            <button
              key={s.title}
              type="button"
              className={`onboarding-dot${i === index ? ' is-current' : ''}`}
              aria-label={`${i + 1}枚目:${s.title}`}
              aria-current={i === index}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
        <div className="onboarding-actions">
          <button type="button" className="btn btn--plain" onClick={() => go(-1)} disabled={index === 0}>
            戻る
          </button>
          <button ref={nextRef} type="button" className="btn btn--primary" onClick={() => (last ? onClose() : go(1))}>
            {last ? 'はじめる' : '次へ'}
          </button>
        </div>
      </div>
    </div>
  )
}
