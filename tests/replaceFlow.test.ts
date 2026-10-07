import { describe, expect, it, vi } from 'vitest'
import { confirmReplace, type ReplaceDialog } from '../src/backup/replaceFlow'

// バックアップの「置き換える」の前の確認(今のデータを先に書き出すか)

/** 決まった順に答える偽のダイアログ */
function fakeDialog(answers: unknown[]) {
  const asked: { kind: string; title?: string }[] = []
  const next = () => answers.shift()
  const dialog: ReplaceDialog = {
    choose: async (opts) => {
      asked.push({ kind: 'choose', title: opts.title })
      return next() as never
    },
    confirm: async (opts) => {
      asked.push({ kind: 'confirm', title: opts.title })
      return next() as boolean
    },
    alert: async (opts) => {
      asked.push({ kind: 'alert', title: opts.title })
    },
  }
  return { dialog, asked }
}

describe('置き換えの前の確認', () => {
  it('ノートがあるときは「今のデータを先に書き出しますか？」と聞く。キャンセルなら置き換えない', async () => {
    const { dialog, asked } = fakeDialog(['cancel'])
    const exp = vi.fn(async () => {})
    expect(await confirmReplace(dialog, 3, exp)).toBe(false)
    expect(asked).toEqual([{ kind: 'choose', title: '今のデータを先に書き出しますか？' }])
    expect(exp).not.toHaveBeenCalled()
  })

  it('「書き出さずに置き換える」なら、書き出さずに置き換える', async () => {
    const { dialog } = fakeDialog(['skip'])
    const exp = vi.fn(async () => {})
    expect(await confirmReplace(dialog, 3, exp)).toBe(true)
    expect(exp).not.toHaveBeenCalled()
  })

  it('「書き出してから置き換える」なら、書き出して、保存できたかを確かめてから置き換える', async () => {
    const { dialog, asked } = fakeDialog(['export', true])
    const exp = vi.fn(async () => {})
    expect(await confirmReplace(dialog, 3, exp)).toBe(true)
    expect(exp).toHaveBeenCalledTimes(1)
    expect(asked.map((a) => a.kind)).toEqual(['choose', 'confirm'])
  })

  it('書き出したあとの確認でやめたら、置き換えない', async () => {
    const { dialog } = fakeDialog(['export', false])
    expect(await confirmReplace(dialog, 3, async () => {})).toBe(false)
  })

  it('書き出しに失敗したら、知らせて置き換えない', async () => {
    const { dialog, asked } = fakeDialog(['export'])
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(
      await confirmReplace(dialog, 3, async () => {
        throw new Error('保存できない')
      }),
    ).toBe(false)
    spy.mockRestore()
    expect(asked.map((a) => a.kind)).toEqual(['choose', 'alert'])
  })

  it('ノートが1冊もないときは、書き出すかは聞かずに確認1回だけ', async () => {
    const { dialog, asked } = fakeDialog([true])
    const exp = vi.fn(async () => {})
    expect(await confirmReplace(dialog, 0, exp)).toBe(true)
    expect(asked).toEqual([{ kind: 'confirm', title: '置き換えの確認' }])
    expect(exp).not.toHaveBeenCalled()
  })
})
