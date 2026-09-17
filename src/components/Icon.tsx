import type { ReactNode } from 'react';

export type IconName =
  | 'select'
  | 'part'
  | 'custom'
  | 'measure'
  | 'note'
  | 'pan'
  | 'template'
  | 'fit'
  | 'export'
  | 'clear'
  | 'board'
  | 'undo'
  | 'redo'
  | 'new'
  | 'layers'
  | 'chevron'
  | 'eye'
  | 'eye-off'
  | 'plus'
  | 'trash'
  | 'pencil'
  | 'search'
  | 'lock'
  | 'unlock'
  | 'up'
  | 'down';

const PATHS: Record<IconName, ReactNode> = {
  select: <path d="M6 3.5l11.5 6.8-4.9 1.3-2.4 4.7L6 3.5z" />,
  part: <rect x="4" y="4" width="16" height="16" rx="2.5" />,
  custom: (
    <>
      <path d="M4 8h8M17 8h3M4 16h3M12 16h8" />
      <circle cx="14.5" cy="8" r="2.2" />
      <circle cx="9.5" cy="16" r="2.2" />
    </>
  ),
  measure: (
    <>
      <rect x="2.5" y="8" width="19" height="8" rx="1.6" />
      <path d="M7 8v3M11 8v4M15 8v3M19 8v4" />
    </>
  ),
  note: (
    <>
      <rect x="3.5" y="4" width="16" height="16" rx="2" />
      <path d="M15 4v5h5" />
      <path d="M7.5 11.5h7M7.5 14.5h4.5" />
    </>
  ),
  pan: (
    <path d="M12 3v18M3 12h18M12 3l-2.4 2.4M12 3l2.4 2.4M12 21l-2.4-2.4M12 21l2.4-2.4M3 12l2.4-2.4M3 12l2.4 2.4M21 12l-2.4-2.4M21 12l-2.4 2.4" />
  ),
  template: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2.5" />
      <path d="M12 8.5v7M8.5 12h7" />
    </>
  ),
  fit: (
    <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M20 9V5.5A1.5 1.5 0 0 0 18.5 4H15M4 15v3.5A1.5 1.5 0 0 0 5.5 20H9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15" />
  ),
  export: <path d="M12 3v11M8.5 10.5L12 14l3.5-3.5M4.5 20h15" />,
  clear: <path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" />,
  board: <path d="M12 3s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11z" />,
  undo: (
    <>
      <path d="M8 4L3 9l5 5" />
      <path d="M3 9h11a6 6 0 0 1 0 12h-5" />
    </>
  ),
  redo: (
    <>
      <path d="M16 4l5 5-5 5" />
      <path d="M21 9H10a6 6 0 0 0 0 12h5" />
    </>
  ),
  new: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3l9 4.5-9 4.5-9-4.5L12 3z" />
      <path d="M3 12l9 4.5 9-4.5" />
      <path d="M3 16.5L12 21l9-4.5" />
    </>
  ),
  chevron: <path d="M9 6l6 6-6 6" />,
  eye: (
    <>
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6" />
      <path d="M4 4l16 16" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  trash: (
    <>
      <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5" />
      <path d="M10 10.5v5.5M14 10.5v5.5" />
    </>
  ),
  pencil: (
    <>
      <path d="M4 20l4.5-1L20 7.5 16.5 4 5 15.5 4 20z" />
      <path d="M14.5 6l3.5 3.5" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
      <circle cx="12" cy="15.5" r="1.6" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 7.5-1.8" />
      <circle cx="12" cy="15.5" r="1.6" />
    </>
  ),
  up: <path d="M6 14.5l6-6 6 6" />,
  down: <path d="M6 9.5l6 6 6-6" />,
};

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
