import { SCHEMA_VERSION } from '../db/db'
import { APP_VERSION } from '../version'

/**
 * 不具合報告。Googleフォームを、アプリのバージョンと端末の情報を入力済みの状態で開く。
 * ノートの中身・タイトルは送らない。内容の欄は空のまま開き、利用者に書いてもらう
 */

const FORM_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLSebXSlYht9XNDmAsnL9XZXPkoZYKOA6-Qty0xBmvUJ2qZFRWA/viewform'

/** フォームの質問の番号(内容 entry.1939266264 は入力しない) */
const ENTRY = {
  version: 'entry.664855706',
  device: 'entry.1576003261',
} as const

/** 報告に入れる情報(ノートの中身は入れない) */
export interface ReportInfo {
  appVersion: string
  schemaVersion: number
  userAgent: string
  /** 画面の大きさ(CSS ピクセル)と、表示の倍率 */
  screen: { width: number; height: number; dpr: number }
  /** ホーム画面に追加して開いているか */
  standalone: boolean
  /** 明るさの設定(端末に合わせる・ライト・ダーク)と、実際の表示 */
  theme: string
  /** 文字サイズの設定(小〜特大) */
  textSize: string
}

/** 今の端末の情報を集める */
export function collectReportInfo(themeLabel: string, textSizeLabel: string): ReportInfo {
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  return {
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    userAgent: navigator.userAgent,
    screen: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 },
    standalone,
    theme: themeLabel,
    textSize: textSizeLabel,
  }
}

/** 「端末の情報」の欄に入れる文(画面にもこのまま見せる) */
export function deviceText(info: ReportInfo): string {
  return [
    `ブラウザ・OS:${info.userAgent}`,
    `画面:${info.screen.width}×${info.screen.height}(倍率 ${info.screen.dpr})`,
    `起動のしかた:${info.standalone ? 'ホーム画面から' : 'ブラウザから'}`,
    `明るさ:${info.theme}`,
    `文字サイズ:${info.textSize}`,
    `データ構造:${info.schemaVersion}`,
  ].join('\n')
}

/** 入力済みのフォームの URL */
export function buildReportUrl(info: ReportInfo): string {
  const params = new URLSearchParams({
    usp: 'pp_url',
    [ENTRY.version]: info.appVersion,
    [ENTRY.device]: deviceText(info),
  })
  return `${FORM_URL}?${params.toString()}`
}
