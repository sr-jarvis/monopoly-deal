import { useEffect, useRef, type ReactNode } from 'react';

interface AtlasHandPanelProps {
  title: string;
  status: string;
  onClose: () => void;
  suspended?: boolean;
  children: ReactNode;
}

/** A retained sheet: opening a card never remounts the hand or public table. */
export function AtlasHandPanel({ title, status, onClose, suspended = false, children }: AtlasHandPanelProps) {
  const panel = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  const lastInside = useRef<HTMLElement | null>(null);
  close.current = onClose;

  useEffect(() => {
    const previousState: unknown = window.history.state?.atlasPanel ? window.history.state.previousState : window.history.state;
    // Delay the history write so StrictMode's setup/cleanup probe is inert.
    let ownsEntry = false;
    const setup = window.setTimeout(() => {
      if (!window.history.state?.atlasPanel) window.history.pushState({ atlasPanel: true, previousState }, '');
      ownsEntry = true;
      window.addEventListener('popstate', onBack);
    }, 0);
    const onBack = () => {
      // Back first dismisses a card layered over this retained sheet.
      if (panel.current?.inert) window.history.pushState({ atlasPanel: true, previousState }, '');
      close.current();
    };
    return () => {
      window.clearTimeout(setup);
      window.removeEventListener('popstate', onBack);
      if (ownsEntry && window.history.state?.atlasPanel) window.history.back();
    };
  }, []);

  useEffect(() => {
    const element = panel.current;
    if (!element) return;
    element.inert = suspended;
    if (suspended) return;
    const focusables = () => Array.from(element.querySelectorAll<HTMLElement>('button:not(:disabled), select, input, [tabindex="0"]')).filter(node => node.getClientRects().length > 0);
    (lastInside.current?.isConnected ? lastInside.current : focusables()[0])?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      // Native Settings is a higher top-layer dialog and owns its own keyboard.
      if (document.querySelector('dialog[open]')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        close.current();
      }
      if (event.key === 'Tab') {
        const nodes = focusables();
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (event.shiftKey && (document.activeElement === first || !element.contains(document.activeElement))) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !element.contains(document.activeElement))) {
          event.preventDefault(); first?.focus();
        }
      }
    };
    const remember = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && element.contains(event.target)) lastInside.current = event.target;
    };
    document.addEventListener('keydown', onKey, true);
    element.addEventListener('focusin', remember);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      element.removeEventListener('focusin', remember);
    };
  }, [suspended]);

  return <div className="atlas-sheet-overlay" aria-hidden={suspended || undefined}>
    <section ref={panel} className="atlas-sheet" role="dialog" aria-modal={!suspended} aria-labelledby="atlas-sheet-title">
      <header className="atlas-sheet-head">
        <div><small>{status}</small><h2 id="atlas-sheet-title">{title}</h2></div>
        <button type="button" className="atlas-icon" onClick={onClose} aria-label="Close panel">×</button>
      </header>
      <div className="atlas-sheet-body">{children}</div>
    </section>
  </div>;
}
