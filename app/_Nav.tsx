'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

// The staff sidebar rail (Beacon .fh-sidebar). Grouped the way the desk thinks about the day:
// the work itself, the signals over it, and reference. The parent face never renders this —
// it has its own minimal chrome (QM-D34: one item, two faces).
const SECTIONS: { title: string; items: { href: string; icon: keyof typeof ICONS; label: string; isNew?: boolean }[] }[] = [
  {
    title: 'The desk',
    items: [
      { href: '/', icon: 'queue', label: 'Queue' },
      { href: '/my', icon: 'my', label: 'My work' },
      { href: '/log', icon: 'log', label: 'Log a request' },
      // The mailbox got its own room in the email-visibility round (2026-08-24): health,
      // the pull button and the pass history in ONE home; the queue carries a one-line
      // strip that links here rather than repeating it (recruitment's 23-Aug lesson).
      { href: '/mailbox', icon: 'mailbox', label: 'Mailbox', isNew: true },
      // Split out of the Queue in the 26-Aug feedback round (#8): a callback slip is not a
      // request, and 395 of 440 queue items were slips. Its own room, worked as a batch.
      { href: '/switchboard', icon: 'switchboard', label: 'Switchboard', isNew: true },
      // IVR voicemails with their English text, one list (12/13-Oct-2026).
      { href: '/calls', icon: 'recordings', label: 'Voicemails', isNew: true },
      // Feedback #18/#21: who covers the desk, and who gets what.
      { href: '/roster', icon: 'roster', label: 'Who is on', isNew: true },
    ],
  },
  {
    title: 'Signals',
    items: [
      { href: '/patterns', icon: 'patterns', label: 'Patterns' },
      { href: '/oversight', icon: 'oversight', label: 'Oversight' },
    ],
  },
  {
    title: 'Reference',
    items: [
      // Feedback #34: access is curated here now, not by a developer running a script. Visible
      // to everyone — seeing who can do what is not privileged — but only administrators can
      // change it, enforced in app/user-actions.ts rather than by hiding the link.
      { href: '/users', icon: 'users', label: 'Who has access', isNew: true },
      { href: '/help', icon: 'help', label: 'Help' },
    ],
  },
];

const ICONS: Record<string, ReactNode> = {
  recordings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" />
    </svg>
  ),
  roster: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  switchboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.09 4.18 2 2 0 0 1 4.08 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  ),
  queue: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  ),
  my: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  log: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  ),
  patterns: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14" />
    </svg>
  ),
  oversight: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 3v18h18" />
      <path d="M7 15v3M12 10v8M17 6v12" />
    </svg>
  ),
  help: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  ),
  mailbox: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  ),
};

/** A record page (/r/…) is the queue's detail view, so the Queue item stays lit there. */
function isActive(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/' || pathname.startsWith('/r/');
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Nav() {
  const pathname = usePathname();
  return (
    <nav>
      {SECTIONS.map(section => (
        <div key={section.title}>
          <div className="fh-sidebar__section">{section.title}</div>
          {section.items.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={`fh-sidebar__item${isActive(item.href, pathname) ? ' is-active' : ''}`}
            >
              <span className="bcn-ic">{ICONS[item.icon]}</span>
              <span className="bcn-lbl">{item.label}</span>
              {item.isNew && <span className="fh-badge fh-badge--solid text-[10px] ml-auto">New</span>}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
