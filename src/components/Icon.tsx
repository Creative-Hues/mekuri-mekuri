// アイコンはすべてSVGで描く(絵文字・記号はiPhoneとAndroidで見た目が変わるため)
const paths: Record<string, string> = {
  back: 'M12.5 4.5 L7 10 L12.5 15.5',
  prev: 'M12.5 4.5 L7 10 L12.5 15.5',
  next: 'M7.5 4.5 L13 10 L7.5 15.5',
  plus: 'M10 4 V16 M4 10 H16',
  menu: 'M3.5 5.5 H16.5 M3.5 10 H16.5 M3.5 14.5 H16.5',
  settings:
    'M10 7.2 A2.8 2.8 0 1 0 10 12.8 A2.8 2.8 0 1 0 10 7.2 Z M10 2.5 V4.5 M10 15.5 V17.5 M2.5 10 H4.5 M15.5 10 H17.5 M4.7 4.7 L6.1 6.1 M13.9 13.9 L15.3 15.3 M4.7 15.3 L6.1 13.9 M13.9 6.1 L15.3 4.7',
  trash: 'M4 6 H16 M8 6 V4 H12 V6 M5.5 6 L6.3 16.5 H13.7 L14.5 6 M8.5 9 V13.5 M11.5 9 V13.5',
  undo: 'M7 5 L3.5 8.5 L7 12 M3.5 8.5 H12 A4.5 4.5 0 0 1 12 17.5 H9',
  redo: 'M13 5 L16.5 8.5 L13 12 M16.5 8.5 H8 A4.5 4.5 0 0 0 8 17.5 H11',
  bullet:
    'M8 5.5 H17 M8 10 H17 M8 14.5 H17 M3.6 5.5 A0.6 0.6 0 1 0 4.8 5.5 A0.6 0.6 0 1 0 3.6 5.5 M3.6 10 A0.6 0.6 0 1 0 4.8 10 A0.6 0.6 0 1 0 3.6 10 M3.6 14.5 A0.6 0.6 0 1 0 4.8 14.5 A0.6 0.6 0 1 0 3.6 14.5',
  ordered: 'M8 5.5 H17 M8 10 H17 M8 14.5 H17 M3.5 4 L4.5 3.5 V7.5 M3.2 11.5 H5.2 L3.2 14 H5.4',
  todo: 'M3 4 H7.5 V8.5 H3 Z M3 11.5 H7.5 V16 H3 Z M3.8 13.6 L5 14.8 L7 12.4 M10 6.2 H17 M10 13.8 H17',
  toggle: 'M4 6 L7 8.5 L4 11 M10 8.5 H17 M10 13.5 H15',
  pageAdd: 'M5 2.5 H11.5 L15 6 V17.5 H5 Z M10 9 V15 M7 12 H13',
  pageRemove: 'M5 2.5 H11.5 L15 6 V17.5 H5 Z M7 12 H13',
  download: 'M10 3 V12.5 M6 8.5 L10 12.5 L14 8.5 M4 16.5 H16',
  upload: 'M10 13 V3.5 M6 7.5 L10 3.5 L14 7.5 M4 16.5 H16',
  close: 'M5 5 L15 15 M15 5 L5 15',
  marker: 'M11.5 3.5 L15.5 7.5 L9.5 13.5 L5.5 13.5 L5.5 9.5 Z M9 5.9 L13.1 10 M3.5 17 H16.5',
  pages: 'M3 3 H8.5 V8.5 H3 Z M11.5 3 H17 V8.5 H11.5 Z M3 11.5 H8.5 V17 H3 Z M11.5 11.5 H17 V17 H11.5 Z',
  grip: 'M5 6.5 H15 M5 10 H15 M5 13.5 H15',
  keyboardHide:
    'M2.5 3.5 H17.5 V12.5 H2.5 Z M5.5 6.5 H6 M8.5 6.5 H9 M11.5 6.5 H12 M14.5 6.5 H14 M6.5 9.5 H13.5 M7 15.5 L10 18 L13 15.5',
  none: 'M10 3 A7 7 0 1 0 10 17 A7 7 0 1 0 10 3 Z M5 15 L15 5',
  sticky: 'M3.5 3.5 H16.5 V12 L12 16.5 H3.5 Z M16.5 12 H12 V16.5 M6.5 7.5 H13.5 M6.5 10.5 H10.5',
  select: 'M3 4 H7 V8 H3 Z M3.8 6 L4.8 7 L6.4 5 M3 12 H7 V16 H3 Z M10 6 H17 M10 14 H17',
  toc: 'M3.5 5 H5 M8 5 H16.5 M5.5 10 H7 M10 10 H16.5 M5.5 15 H7 M10 15 H16.5',
  dots: 'M4.6 10 H5.4 M9.6 10 H10.4 M14.6 10 H15.4',
  check: 'M4.5 10.5 L8.5 14.5 L15.5 6',
  star: 'M10 2.8 L12.2 7.3 L17.1 8 L13.5 11.4 L14.4 16.3 L10 14 L5.6 16.3 L6.5 11.4 L2.9 8 L7.8 7.3 Z',
  restore: 'M4 10 A6 6 0 1 0 6 5.5 M3.5 3 V6.5 H7',
  palette:
    'M10 3 A7 7 0 1 0 10 17 C11.3 17 11.6 15.9 11 15 C10.4 14.1 10.9 13 12.1 13 H13.8 A3.2 3.2 0 0 0 17 9.8 C17 6 13.9 3 10 3 Z M6.6 9 H6.7 M8.6 6.2 H8.7 M12 6.2 H12.1',
}

export type IconName = keyof typeof paths

/** filled:中を塗りつぶす(お気に入りの星など) */
export function Icon({ name, size = 20, filled = false }: { name: IconName; size?: number; filled?: boolean }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 20 20"
      width={size}
      height={size}
      aria-hidden="true"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  )
}
