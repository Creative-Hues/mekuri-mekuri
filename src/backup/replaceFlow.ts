import type { DialogButton } from '../components/Dialog'

/** 置き換えの確認で使うダイアログの機能(テストで偽物に差し替えられるよう、必要な分だけ) */
export interface ReplaceDialog {
  choose<T>(opts: { title?: string; message: string; buttons: DialogButton<T>[]; cancelValue: T }): Promise<T>
  confirm(opts: { title?: string; message: string; okLabel?: string; danger?: boolean }): Promise<boolean>
  alert(opts: { title?: string; message: string }): Promise<void>
}

/**
 * バックアップの「置き換える」の前の確認。置き換えてよければ true を返す。
 * 今のノートがあるときは、消える前に今のデータを書き出すかを聞く
 * @param noteCount 今あるノートの数(ゴミ箱のノートも含む)
 * @param exportCurrent 今のデータを書き出す処理
 */
export async function confirmReplace(
  dialog: ReplaceDialog,
  noteCount: number,
  exportCurrent: () => Promise<void>,
): Promise<boolean> {
  // 消えるノートがないときは、今までどおりの確認1回だけ
  if (noteCount === 0) {
    return dialog.confirm({
      title: '置き換えの確認',
      message: '今このアプリにあるデータは、ファイルの中身に置き換わります。よろしいですか？',
      okLabel: '置き換える',
      danger: true,
    })
  }

  const choice = await dialog.choose<'cancel' | 'skip' | 'export'>({
    title: '今のデータを先に書き出しますか？',
    message: `置き換えると、今このアプリにあるノート(${noteCount}冊。ゴミ箱を含む)はすべて消えます。念のため、今のデータをバックアップファイルに書き出しておくことをおすすめします。`,
    cancelValue: 'cancel',
    buttons: [
      { label: 'キャンセル', value: 'cancel', kind: 'plain' },
      { label: '書き出さずに置き換える', value: 'skip', kind: 'danger' },
      { label: '書き出してから置き換える', value: 'export', kind: 'primary' },
    ],
  })
  if (choice === 'cancel') return false
  // 「書き出さずに置き換える」は赤いボタンで選んでもらっているので、ここで確定
  if (choice === 'skip') return true

  try {
    await exportCurrent()
  } catch (e) {
    console.error(e)
    await dialog.alert({
      title: '書き出せませんでした',
      message: '今のデータを書き出せなかったため、置き換えをやめました。今のノートは変更されていません。',
    })
    return false
  }
  // ファイルを実際に保存できたかはアプリから分からない(iPhone では保存先を選ぶ画面が出る)ため、確かめてもらう
  return dialog.confirm({
    title: '置き換えの確認',
    message:
      '書き出したバックアップファイルが保存できたことを確かめてから、「置き換える」を押してください。今のノートはすべて消え、読み込んだファイルの中身に置き換わります。',
    okLabel: '置き換える',
    danger: true,
  })
}
