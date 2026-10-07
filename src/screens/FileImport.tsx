import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useDialog } from '../components/Dialog'
import { IMPORT_ACCEPT, importFiles, type ImportResult } from '../import/importFiles'
import { href, navigate } from '../router'

/**
 * 本棚の「ファイルから読み込む」:ファイルを選ぶ・本棚にドロップする → 新しいノートにする。
 * 1つだけ読み込んだときはそのノートを開き、2つ以上なら本棚に残って結果をまとめて知らせる。
 * 再現できなかったもの(斜体など)があれば、読み込んだあとに知らせる
 */
export function useFileImport() {
  const dialog = useDialog()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const busyRef = useRef(false)

  const run = async (files: File[]) => {
    if (files.length === 0 || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    let results: ImportResult[]
    try {
      results = await importFiles(files)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
    const done = results.filter((r) => r.ok)
    if (results.length === 1 && done.length === 1) {
      const r = done[0]
      if (r.messages.length > 0) {
        await dialog.alert({
          title: '読み込みました',
          message: <MessageList intro="次のものは、そのままの形では読み込めませんでした。" items={r.messages} />,
        })
      }
      navigate(href.note(r.note.id))
      return
    }
    await dialog.alert({ title: done.length > 0 ? '読み込みました' : '読み込めませんでした', message: <ResultList results={results} /> })
  }

  // 本棚の画面にファイルをドラッグ&ドロップしたら読み込む(PC)
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files')
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth++
      setDragging(true)
    }
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      // ドロップを受け付ける(ブラウザがファイルを開いてしまわないように)
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'copy'
    }
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      // 説明やダイアログが開いているときは読み込まない
      if (document.querySelector('.dialog-backdrop')) return
      void run([...(e.dataTransfer?.files ?? [])])
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
    // run は毎回作り直されるが、中で使うもの(ダイアログ・ref・state の更新)は変わらないので、最初の1回だけ登録する
  }, [])

  const open = () => inputRef.current?.click()

  const elements = (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={IMPORT_ACCEPT}
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          // 同じファイルをもう一度選べるように空にしておく
          e.target.value = ''
          void run(files)
        }}
      />
      {dragging && (
        <div className="import-drop" aria-hidden="true">
          <p className="import-drop-text">ここに離すと、新しいノートとして読み込みます</p>
          <p className="import-drop-sub">テキスト(.txt)・Markdown(.md)・Word(.docx)</p>
        </div>
      )}
      {busy && (
        <div className="update-banner import-busy" role="status">
          読み込んでいます…
        </div>
      )}
    </>
  )
  return { open, busy, elements }
}

function MessageList({ intro, items }: { intro?: ReactNode; items: string[] }) {
  return (
    <>
      {intro && <p>{intro}</p>}
      <ul className="import-messages">
        {items.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    </>
  )
}

/** 複数のファイルの結果(読み込めたもの・読み込めなかったもの) */
function ResultList({ results }: { results: ImportResult[] }) {
  return (
    <ul className="import-results">
      {results.map((r, i) => (
        <li key={i}>
          <span className="import-file">{r.fileName}</span>
          {r.ok ? (
            <>
              <span>:「{r.note.title || '無題のノート'}」として読み込みました</span>
              {r.messages.length > 0 && <MessageList items={r.messages} />}
            </>
          ) : (
            <span className="import-error">:{r.error}</span>
          )}
        </li>
      ))}
    </ul>
  )
}
