import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { META } from '../db/meta'
import { isPersisted } from '../db/persist'
import { exportBackup } from '../backup/export'
import { BackupError, parseBackup } from '../backup/format'
import { importAppend, importReplace } from '../backup/import'
import { href } from '../router'
import { APP_VERSION } from '../version'
import { Icon } from '../components/Icon'
import { useDialog } from '../components/Dialog'
import { SHORTCUTS, shortcutText } from '../editor/shortcuts'
import { THEME_OPTIONS, setThemePref, useThemePref } from '../theme/theme'

function formatDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function Settings() {
  const dialog = useDialog()
  const fileRef = useRef<HTMLInputElement>(null)
  const lastBackup = useLiveQuery(async () => (await db.meta.get(META.lastBackupAt))?.value as number | undefined, [])
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const themePref = useThemePref()

  useEffect(() => {
    void isPersisted().then(setPersisted)
  }, [])

  const doExport = async () => {
    try {
      await exportBackup()
    } catch (e) {
      console.error(e)
      await dialog.alert({ message: 'バックアップの書き出しに失敗しました。' })
    }
  }

  const doImport = async (file: File) => {
    let backup
    try {
      backup = parseBackup(await file.text())
    } catch (e) {
      await dialog.alert({
        title: '読み込めませんでした',
        message: e instanceof BackupError ? e.message : 'ファイルを読み込めませんでした。',
      })
      return
    }
    const mode = await dialog.choose<'replace' | 'append' | null>({
      title: 'バックアップを読み込む',
      message: (
        <>
          <p>
            ファイルには{backup.notes.length}冊のノートが入っています(
            {formatDate(backup.exportedAt)} に書き出したもの)。
          </p>
          <p>今あるノートをどうしますか？</p>
        </>
      ),
      cancelValue: null,
      buttons: [
        { label: 'キャンセル', value: null, kind: 'plain' },
        { label: '今のノートに追加する', value: 'append', kind: 'primary' },
        { label: '今のノートを消して置き換える', value: 'replace', kind: 'danger' },
      ],
    })
    if (!mode) return
    if (mode === 'replace') {
      const ok = await dialog.confirm({
        title: '置き換えの確認',
        message: '今このアプリにあるノートはすべて消え、ファイルの中身に置き換わります。よろしいですか？',
        okLabel: '置き換える',
        danger: true,
      })
      if (!ok) return
    }
    try {
      if (mode === 'replace') await importReplace(backup)
      else await importAppend(backup)
      await dialog.alert({ message: '読み込みました。' })
    } catch (e) {
      console.error(e)
      await dialog.alert({ message: '読み込みに失敗しました。今のノートは変更されていません。' })
    }
  }

  return (
    <div className="settings">
      <header className="settings-header">
        <a className="icon-btn" href={href.shelf()} aria-label="本棚へ戻る" title="本棚へ戻る">
          <Icon name="back" />
        </a>
        <h1>設定</h1>
      </header>

      <section className="settings-section">
        <h2>表示</h2>
        <p className="settings-note">
          ダークモードにしても、背景色を選んだノートの紙はその色のままです(文字の色は読みやすく調整されます)。
        </p>
        <div className="segmented" role="radiogroup" aria-label="画面の明るさ">
          {THEME_OPTIONS.map((o) => (
            <button
              key={o.value}
              role="radio"
              aria-checked={themePref === o.value}
              className={`segmented-btn${themePref === o.value ? ' is-selected' : ''}`}
              onClick={() => setThemePref(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h2>バックアップ</h2>
        <p className="settings-note">
          ノートはこの端末の中だけに保存されています。端末の故障やブラウザのデータ削除に備えて、ときどきバックアップしてください。
        </p>
        <div className="settings-row">
          <span>前回のバックアップ</span>
          <span>{lastBackup ? formatDate(lastBackup) : 'まだありません'}</span>
        </div>
        <div className="settings-actions">
          <button className="btn btn--primary" onClick={() => void doExport()}>
            <Icon name="download" size={18} />
            バックアップを書き出す
          </button>
          <button className="btn btn--plain" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={18} />
            バックアップを読み込む
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void doImport(file)
            }}
          />
        </div>
      </section>

      <section className="settings-section">
        <h2>データの保護</h2>
        <div className="settings-row">
          <span>消されにくい保存</span>
          <span>{persisted === null ? '確認できません' : persisted ? '有効' : '無効'}</span>
        </div>
        {persisted === false && (
          <p className="settings-note">
            ブラウザが「消されにくい保存」を許可していません。ホーム画面に追加して使うと有効になりやすくなります。
          </p>
        )}
      </section>

      <section className="settings-section">
        <h2>ショートカットキー(PC)</h2>
        <p className="settings-note">キーボードをつないだ端末で使えます。日本語キーボードでも同じキーで使えます。</p>
        <dl className="shortcut-list">
          {SHORTCUTS.map((s) => (
            <div key={s.id} className="settings-row">
              <dt>{s.label}</dt>
              <dd>
                {s.combos.map((_, i) => (
                  <kbd key={i}>{shortcutText(s.id, i)}</kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="settings-section">
        <h2>このアプリについて</h2>
        <div className="settings-row">
          <span>バージョン</span>
          <span>{APP_VERSION}</span>
        </div>
      </section>
    </div>
  )
}
