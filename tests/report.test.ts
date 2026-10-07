import { describe, expect, it } from 'vitest'
import { buildReportUrl, deviceText, type ReportInfo } from '../src/report/report'

// 不具合報告:入力済みの Googleフォームの URL

const info: ReportInfo = {
  appVersion: '1.1.0',
  schemaVersion: 5,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',
  screen: { width: 390, height: 844, dpr: 3 },
  standalone: true,
  theme: '端末に合わせる(表示:ダーク)',
  textSize: '大',
}

describe('不具合報告のフォーム', () => {
  it('バージョンと端末の情報を入力済みにし、内容の欄は空のまま', () => {
    const url = new URL(buildReportUrl(info))
    expect(url.origin + url.pathname).toBe(
      'https://docs.google.com/forms/d/e/1FAIpQLSebXSlYht9XNDmAsnL9XZXPkoZYKOA6-Qty0xBmvUJ2qZFRWA/viewform',
    )
    expect(url.searchParams.get('usp')).toBe('pp_url')
    expect(url.searchParams.get('entry.664855706')).toBe('1.1.0')
    expect(url.searchParams.get('entry.1576003261')).toBe(deviceText(info))
    // 内容(entry.1939266264)は入れない
    expect(url.searchParams.has('entry.1939266264')).toBe(false)
    expect([...url.searchParams.keys()]).toEqual(['usp', 'entry.664855706', 'entry.1576003261'])
  })

  it('日本語・改行・記号も、文字化けせずに渡る', () => {
    const url = new URL(buildReportUrl({ ...info, theme: 'ライト & ダーク #1' }))
    expect(url.searchParams.get('entry.1576003261')).toContain('明るさ:ライト & ダーク #1')
    expect(url.searchParams.get('entry.1576003261')).toContain('\n')
  })

  it('端末の情報の中身', () => {
    expect(deviceText(info)).toBe(
      [
        `ブラウザ・OS:${info.userAgent}`,
        '画面:390×844(倍率 3)',
        '起動のしかた:ホーム画面から',
        '明るさ:端末に合わせる(表示:ダーク)',
        '文字サイズ:大',
        'データ構造:5',
      ].join('\n'),
    )
  })
})
