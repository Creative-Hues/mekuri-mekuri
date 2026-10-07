import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

export interface DialogButton<T> {
  label: string
  value: T
  kind?: 'primary' | 'danger' | 'plain'
}

interface DialogRequest {
  title?: string
  message: ReactNode
  buttons: DialogButton<unknown>[]
  /** 外側をタップ・Escキーで閉じたときの値 */
  cancelValue: unknown
  /** 文字の入力欄(prompt のとき) */
  input?: { initial: string; placeholder?: string; type?: 'text' | 'url' }
  resolve: (value: unknown) => void
}

/** prompt の「OK」ボタンの目印(押したら入力欄の文字を返す) */
const INPUT_OK = Symbol('ok')

export interface DialogApi {
  /** ボタンを選ばせる。選んだボタンの value を返す */
  choose<T>(opts: { title?: string; message: ReactNode; buttons: DialogButton<T>[]; cancelValue: T }): Promise<T>
  /** 「はい/いいえ」の確認 */
  confirm(opts: { title?: string; message: ReactNode; okLabel?: string; danger?: boolean }): Promise<boolean>
  /** お知らせ(OKだけ) */
  alert(opts: { title?: string; message: ReactNode }): Promise<void>
  /** 文字を入力してもらう。キャンセルなら null */
  prompt(opts: {
    title?: string
    message: ReactNode
    initial?: string
    placeholder?: string
    type?: 'text' | 'url'
    okLabel?: string
  }): Promise<string | null>
}

const DialogContext = createContext<DialogApi | null>(null)

export function useDialog(): DialogApi {
  const api = useContext(DialogContext)
  if (!api) throw new Error('DialogProvider がありません')
  return api
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<DialogRequest[]>([])
  const current = queue[0]

  const choose = useCallback<DialogApi['choose']>(
    (opts) =>
      new Promise((resolve) => {
        setQueue((q) => [
          ...q,
          {
            title: opts.title,
            message: opts.message,
            buttons: opts.buttons as DialogButton<unknown>[],
            cancelValue: opts.cancelValue,
            resolve: resolve as (v: unknown) => void,
          },
        ])
      }),
    [],
  )

  const api = useRef<DialogApi>({
    choose,
    confirm: ({ title, message, okLabel = 'OK', danger }) =>
      choose({
        title,
        message,
        cancelValue: false,
        buttons: [
          { label: 'キャンセル', value: false, kind: 'plain' },
          { label: okLabel, value: true, kind: danger ? 'danger' : 'primary' },
        ],
      }),
    alert: async ({ title, message }) => {
      await choose({ title, message, cancelValue: undefined, buttons: [{ label: 'OK', value: undefined, kind: 'primary' }] })
    },
    prompt: ({ title, message, initial = '', placeholder, type, okLabel = 'OK' }) =>
      new Promise<string | null>((resolve) => {
        setQueue((q) => [
          ...q,
          {
            title,
            message,
            input: { initial, placeholder, type },
            cancelValue: null,
            buttons: [
              { label: 'キャンセル', value: null, kind: 'plain' },
              { label: okLabel, value: INPUT_OK, kind: 'primary' },
            ],
            resolve: resolve as (v: unknown) => void,
          },
        ])
      }),
  }).current

  const close = (value: unknown, text?: string) => {
    current?.resolve(value === INPUT_OK ? (text ?? '') : value)
    setQueue((q) => q.slice(1))
  }

  return (
    <DialogContext.Provider value={api}>
      {children}
      {current && <DialogView request={current} onClose={close} />}
    </DialogContext.Provider>
  )
}

function DialogView({
  request,
  onClose,
}: {
  request: DialogRequest
  onClose: (v: unknown, text?: string) => void
}) {
  const lastButton = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState(request.input?.initial ?? '')
  // 続けて別の入力欄を出したとき、前の文字が残らないようにする
  useEffect(() => setText(request.input?.initial ?? ''), [request])
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    } else {
      lastButton.current?.focus()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(request.cancelValue)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [request, onClose])

  return (
    <div className="dialog-backdrop" onClick={() => onClose(request.cancelValue)}>
      <div className="dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {request.title && <h2 className="dialog-title">{request.title}</h2>}
        <div className="dialog-message">{request.message}</div>
        {request.input && (
          <input
            ref={inputRef}
            className="dialog-input"
            type={request.input.type ?? 'text'}
            inputMode={request.input.type === 'url' ? 'url' : undefined}
            autoCapitalize="off"
            autoCorrect="off"
            value={text}
            placeholder={request.input.placeholder}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) onClose(INPUT_OK, text)
            }}
          />
        )}
        <div className="dialog-buttons">
          {request.buttons.map((b, i) => (
            <button
              key={i}
              ref={i === request.buttons.length - 1 ? lastButton : undefined}
              className={`btn btn--${b.kind ?? 'plain'}`}
              onClick={() => onClose(b.value, text)}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
