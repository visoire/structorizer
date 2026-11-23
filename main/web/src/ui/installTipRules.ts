// SPDX-License-Identifier: GPL-3.0-or-later
// "Add to Home Screen" tip for iPad (and iPhone): the pure rules, without DOM (tests/install-tip.test.ts, UI in InstallTip.tsx).
//   Safari on iPadOS runs Structorizer best as a Home Screen web app: full screen without the Safari
//   bars, offline from the service worker, and no Safari gestures in the way of the Apple Pencil.
//   A Safari tab gets the tip once; "Not now" brings it back after two weeks, "Do not show again"
//   never. Started from the Home Screen (standalone) it is never shown.

export interface InstallTipState {
  /** 'never', or the time (ms) from which the tip may come back */
  until?: number | 'never';
}

export interface InstallEnv {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  /** navigator.standalone (Safari) or display-mode: standalone */
  standalone: boolean;
  /** http(s) page: a file:// page (the single-file edition) cannot be installed */
  installable: boolean;
}

export const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;
export const INSTALL_TIP_KEY = 'structorizer-web:install-tip';

/** iPad (iPadOS reports itself as a Mac, but with touch points), iPhone or iPod touch. */
export function isAppleTouchDevice(env: Pick<InstallEnv, 'userAgent' | 'platform' | 'maxTouchPoints'>): boolean {
  if (/\b(iPad|iPhone|iPod)\b/.test(env.userAgent)) return true;
  return env.platform === 'MacIntel' && env.maxTouchPoints > 1;
}

export function shouldOfferInstall(env: InstallEnv, state: InstallTipState | null, now: number): boolean {
  if (!env.installable || env.standalone || !isAppleTouchDevice(env)) return false;
  const u = state?.until;
  if (u === 'never') return false;
  if (typeof u === 'number' && now < u) return false;
  return true;
}

export const snoozed = (now: number): InstallTipState => ({ until: now + SNOOZE_MS });
export const neverAgain = (): InstallTipState => ({ until: 'never' });

export function readInstallTipState(storage: Pick<Storage, 'getItem'> | null): InstallTipState | null {
  try {
    const raw = storage?.getItem(INSTALL_TIP_KEY);
    return raw ? (JSON.parse(raw) as InstallTipState) : null;
  } catch {
    return null;
  }
}

export function writeInstallTipState(storage: Pick<Storage, 'setItem'> | null, s: InstallTipState): void {
  try { storage?.setItem(INSTALL_TIP_KEY, JSON.stringify(s)); } catch { /* private mode: show again next time */ }
}

/** The environment of this page. */
export function currentInstallEnv(singleFile: boolean): InstallEnv {
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: nav.userAgent,
    platform: nav.platform ?? '',
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    standalone: nav.standalone === true || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches),
    installable: !singleFile && /^https?:$/.test(location.protocol),
  };
}
