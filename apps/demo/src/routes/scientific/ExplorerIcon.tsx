import type { ReactNode } from 'react';

const paths = {
  select: (
    <>
      <path d="M4 3v16l4-4 3 6 3-1-3-6h6L4 3Z" />
    </>
  ),
  zoom: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5M7.5 10.5h6m-3-3v6" />
    </>
  ),
  reset: (
    <>
      <path d="M3 10a9 9 0 1 1 2 8M3 4v6h6" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3h.01" />
    </>
  ),
  settings: (
    <>
      <path d="M4 6h5m4 0h7M4 12h9m4 0h3M4 18h2m4 0h10" />
      <circle cx="11" cy="6" r="2" />
      <circle cx="15" cy="12" r="2" />
      <circle cx="8" cy="18" r="2" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  expand: (
    <>
      <path d="M14 3h7v7M21 3l-7 7M10 21H3v-7m0 7 7-7" />
    </>
  ),
  collapse: (
    <>
      <path d="M21 10h-7V3m0 7 7-7M3 14h7v7m0-7-7 7" />
    </>
  ),
  play: <path d="m8 4 12 8-12 8V4Z" />,
  pause: (
    <>
      <path d="M8 4v16M16 4v16" />
    </>
  ),
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
} satisfies Record<string, ReactNode>;

export function ExplorerIcon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      className="sci-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
