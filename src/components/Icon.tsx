import type { ReactNode } from 'react';

export type IconName =
  | 'select'
  | 'part'
  | 'custom'
  | 'measure'
  | 'pan'
  | 'template'
  | 'fit'
  | 'export'
  | 'clear'
  | 'board'
  | 'undo'
  | 'redo'
  | 'new';

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
