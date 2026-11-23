// SPDX-License-Identifier: GPL-3.0-or-later
// iPad / iPhone: how to put Structorizer on the Home Screen (rules in installTipRules.ts).
import { useEffect } from 'react';
import { useTranslator } from '../i18n';
import { useStore } from '../store/diagramStore';
import { usePrefs } from '../store/prefsStore';
import { Modal } from './ElementEditor';
import {
  currentInstallEnv, neverAgain, readInstallTipState, shouldOfferInstall, snoozed, writeInstallTipState,
} from './installTipRules';

declare const __SINGLE_FILE__: boolean;
const IS_SINGLE = typeof __SINGLE_FILE__ === 'boolean' && __SINGLE_FILE__;

const storage = (): Storage | null => { try { return localStorage; } catch { return null; } };

/** Safari's Share symbol: a square with an arrow pointing up. */
function ShareIcon() {
  return (
    <svg className="install-share" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12M8 7l4-4 4 4" /><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
    </svg>
  );
}

/** Opens the tip once, a moment after the start, in a Safari tab on an iPad or iPhone. */
export function useInstallTip(): void {
  useEffect(() => {
    if (!shouldOfferInstall(currentInstallEnv(IS_SINGLE), readInstallTipState(storage()), Date.now())) return;
    const h = window.setTimeout(() => {
      const s = useStore.getState();
      if (!s.dialog && !s.editor && !s.groupDialog) {
        installTipAuto = true;
        s.setDialog('install');
      }
    }, 1500);
    return () => clearTimeout(h);
  }, []);
}

/** true while the dialog was opened by the automatic tip (then it offers "Not now" / "never") */
let installTipAuto = false;

export function InstallDialog() {
  const s = useStore();
  const t = useTranslator(usePrefs((p) => p.lang));
  const auto = installTipAuto;
  const env = currentInstallEnv(IS_SINGLE);
  const close = (remember?: 'snooze' | 'never') => {
    if (remember === 'snooze') writeInstallTipState(storage(), snoozed(Date.now()));
    if (remember === 'never') writeInstallTipState(storage(), neverAgain());
    installTipAuto = false;
    s.setDialog(null);
  };
  return (
    <Modal title={t('installTitle')} onClose={() => close(auto ? 'snooze' : undefined)}
      cancelLabel={auto ? t('installNotNow') : t('close')}
      okLabel={auto ? t('installNever') : undefined} onOk={auto ? () => close('never') : undefined}>
      {env.standalone ? (
        <p>{t('installDone')}</p>
      ) : (
        <>
          <p>{t('installIntro')}</p>
          <ol className="install-steps">
            <li>{t('installStep1')} <ShareIcon /></li>
            <li>{t('installStep2')}</li>
            <li>{t('installStep3')}</li>
            <li>{t('installStep4')}</li>
          </ol>
          <p className="hint">{t('installDataNote')}</p>
          {!env.installable && <p className="hint">{t('installSingleNote')}</p>}
        </>
      )}
    </Modal>
  );
}
