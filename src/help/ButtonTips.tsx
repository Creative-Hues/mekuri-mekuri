import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * ヘッダー・ツールバーのボタンの名前を小さく出す。
 * PC:マウスを乗せると出す。スマホ:長押しすると出す(指を離してもボタンは押さない)。
 * 対象は、scope(ノート画面・本棚)の中の data-tip の付いたボタンだけ(help/buttons.tsx の tipProps)。
 * 行のハンドル(≡)の長押し(選択モード)などには data-tip がないので、ここでは何もしない
 */

const HOVER_DELAY = 400
const LONG_PRESS = 500
/** 長押しの途中で指がこれ以上動いたら、スクロールとみなしてやめる */
const MOVE_LIMIT = 10
/** 長押しで出した名前を、指を離してから消すまで */
const TOUCH_HIDE = 1500

interface Tip {
  text: string
  keyText?: string
  rect: DOMRect
}

/** scope:名前を出す範囲(CSS のセレクタ) */
export function ButtonTips({ scope }: { scope: string }) {
  const [tip, setTip] = useState<Tip | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const tipTarget = (t: EventTarget | null) =>
      t instanceof Element ? (t.closest(`${scope} [data-tip]`) as HTMLElement | null) : null
    let timer = 0
    let hideTimer = 0
    let press: { el: HTMLElement; x: number; y: number } | null = null
    /** 長押しで名前を出したボタン(続けて来るクリックを止める) */
    let suppress: { el: HTMLElement; until: number } | null = null

    const clear = () => {
      window.clearTimeout(timer)
      press = null
    }
    const show = (el: HTMLElement, withKey: boolean) => {
      window.clearTimeout(hideTimer)
      setTip({
        text: el.dataset.tip ?? '',
        keyText: withKey ? el.dataset.tipKey : undefined,
        rect: el.getBoundingClientRect(),
      })
    }
    const hide = () => {
      window.clearTimeout(hideTimer)
      setTip(null)
    }

    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      const el = tipTarget(e.target)
      if (!el) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => show(el, true), HOVER_DELAY)
    }
    const onOut = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      const el = tipTarget(e.target)
      if (!el || (e.relatedTarget instanceof Node && el.contains(e.relatedTarget))) return
      window.clearTimeout(timer)
      hide()
    }
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') {
        // クリックしたら名前は消す
        window.clearTimeout(timer)
        hide()
        return
      }
      const el = tipTarget(e.target)
      clear()
      // 新しく押し始めたら、前の長押しのあとのクリック止めは終わり
      // (長押しのあとにクリックが来ない端末で、次に押したボタンが効かなくならないように)
      suppress = null
      if (!el) return
      press = { el, x: e.clientX, y: e.clientY }
      timer = window.setTimeout(() => {
        if (!press) return
        show(press.el, false)
        suppress = { el: press.el, until: Number.POSITIVE_INFINITY }
      }, LONG_PRESS)
    }
    const onMove = (e: PointerEvent) => {
      if (!press || e.pointerType === 'mouse') return
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > MOVE_LIMIT) clear()
    }
    const onUp = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return
      clear()
      if (suppress) {
        // 指を離した直後に来るクリックだけを止める
        suppress.until = Date.now() + 500
        hideTimer = window.setTimeout(() => setTip(null), TOUCH_HIDE)
      }
    }
    const onClick = (e: MouseEvent) => {
      if (!suppress) return
      const s = suppress
      suppress = null
      if (Date.now() <= s.until && e.target instanceof Node && s.el.contains(e.target)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    // Android の Chrome は長押しでメニュー(contextmenu)を出すので、名前を出すボタンでは止める
    const onContextMenu = (e: Event) => {
      if (tipTarget(e.target)) e.preventDefault()
    }
    const onScroll = () => {
      clear()
      hide()
    }

    document.addEventListener('pointerover', onOver)
    document.addEventListener('pointerout', onOut)
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('pointermove', onMove, true)
    document.addEventListener('pointerup', onUp, true)
    document.addEventListener('pointercancel', onUp, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.clearTimeout(timer)
      window.clearTimeout(hideTimer)
      document.removeEventListener('pointerover', onOver)
      document.removeEventListener('pointerout', onOut)
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('pointermove', onMove, true)
      document.removeEventListener('pointerup', onUp, true)
      document.removeEventListener('pointercancel', onUp, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [scope])

  // 画面からはみ出さない位置に置く:ボタンの上(上に場所がなければ下)、左右は画面の中に収める
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!tip || !box) return
    const margin = 6
    const w = box.offsetWidth
    const h = box.offsetHeight
    const vw = document.documentElement.clientWidth
    const left = Math.min(Math.max(margin, tip.rect.left + tip.rect.width / 2 - w / 2), vw - w - margin)
    const above = tip.rect.top - h - margin
    const top = above >= margin ? above : tip.rect.bottom + margin
    box.style.left = `${left}px`
    box.style.top = `${top}px`
    box.style.visibility = 'visible'
  }, [tip])

  if (!tip) return null
  return (
    <div ref={boxRef} className="button-tip" role="tooltip" style={{ visibility: 'hidden' }}>
      {tip.text}
      {tip.keyText && <span className="button-tip-key">{tip.keyText}</span>}
    </div>
  )
}
