import { useEffect, useRef, useState } from 'react'

/**
 * 短い案内(画面の下に数秒だけ出す)。
 * 「結合したセルの中には移動できません」「3冊をゴミ箱に移しました」など、
 * 押して閉じる必要のない知らせに使う。どこからでも showToast で出せる
 */

const TOAST_EVENT = 'mekuri:toast'
/** 出しておく時間(ミリ秒) */
const TOAST_MS = 2600

export function showToast(message: string) {
  window.dispatchEvent(new CustomEvent<string>(TOAST_EVENT, { detail: message }))
}

/** 案内を出す場所(App に1つだけ置く) */
export function Toasts() {
  const [message, setMessage] = useState<{ text: string; id: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const onToast = (e: Event) => {
      const text = (e as CustomEvent<string>).detail
      if (timer.current) clearTimeout(timer.current)
      setMessage((prev) => ({ text, id: (prev?.id ?? 0) + 1 }))
      timer.current = setTimeout(() => setMessage(null), TOAST_MS)
    }
    window.addEventListener(TOAST_EVENT, onToast)
    return () => {
      window.removeEventListener(TOAST_EVENT, onToast)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  return (
    <div className="toast-area" role="status" aria-live="polite">
      {message && (
        <div key={message.id} className="toast">
          {message.text}
        </div>
      )}
    </div>
  )
}
