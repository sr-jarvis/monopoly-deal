import React, { useEffect, useId, useRef, type ReactNode } from 'react';
import type { Card } from '@monopoly-deal/shared';
import { CardView } from './CardView';

// Printed tiers, checked against the server catalog in atlas-dialog.spec.js.
export const ATLAS_RENT_TIERS: Record<string, number[]> = {
  Brown: [1, 2], LightBlue: [1, 2, 3], Purple: [1, 2, 4], Orange: [1, 3, 5],
  Red: [2, 3, 6], Yellow: [2, 4, 6], Green: [2, 4, 7], DarkBlue: [3, 8],
  Railroad: [1, 2, 3, 4], Utility: [1, 2]
};
const ACTION_RULES: Record<string, string> = {
  'Pass Go': 'Draw 2 cards from the deck. Uses one play.',
  'Debt Collector': 'Choose one opponent to pay you 5M from their bank or properties. No change is given.',
  'Its My Birthday': 'Every opponent pays you 2M from their bank or properties. No change is given.',
  'Sly Deal': 'Steal one property from an opponent. You cannot take a card from a complete set.',
  'Forced Deal': 'Swap one of your properties for one opponent property. Neither property may belong to a complete set.',
  'Deal Breaker': 'Steal one complete property set from one opponent, including its attached buildings.',
  'House': 'Add to a complete set you own, except Railroad or Utility. One House per set; adds 3M to rent.',
  'Hotel': 'Add to a complete set with a House, except Railroad or Utility. One Hotel per set; adds 4M to rent in addition to the House.',
  'Double The Rent': 'Play together with a Rent card, never alone. Each doubler uses one additional play. One doubles rent; two quadruple it, using all 3 plays.',
  'Just Say No': 'Use the response dialog to cancel an action played against you, or counter another Just Say No. It is not a standalone action on your turn.'
};
const humanize = (value: string) => value.replace(/([a-z])([A-Z])/g, '$1 $2');

/** Separate from React so lifecycle/keyboard behavior can be exercised without a server. */
export function containAtlasDialog(element: HTMLElement, onClose: () => void) {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const nativeOpen = () => !!document.querySelector('dialog[open]');
  const settingsTrigger = (node: Element | null) => !!node?.closest('.md-settings-trigger');
  const focusables = () => {
    const nodes = Array.from(element.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]'));
    // The persistent host control remains keyboard reachable above the sheet.
    const settings = document.querySelector<HTMLElement>('.md-settings-trigger');
    if (settings) nodes.push(settings);
    return nodes.filter(node => node.getClientRects().length > 0);
  };
  const first = () => (focusables()[0] || element).focus({ preventScroll: true });
  if (!nativeOpen()) first();
  const keydown = (event: KeyboardEvent) => {
    // GameBoard capture owns Escape first; native Settings supersedes this sheet.
    if (nativeOpen() || event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); onClose();
    } else if (event.key === 'Tab') {
      const nodes = focusables();
      const index = nodes.indexOf(document.activeElement as HTMLElement);
      event.preventDefault();
      const next = index < 0 ? (event.shiftKey ? nodes.length - 1 : 0) : (index + (event.shiftKey ? -1 : 1) + nodes.length) % nodes.length;
      (nodes[next] || element).focus({ preventScroll: true });
    }
  };
  const focusin = (event: FocusEvent) => {
    if (!nativeOpen() && !element.contains(event.target as Node) && !settingsTrigger(event.target instanceof Element ? event.target : null)) first();
  };
  document.addEventListener('keydown', keydown);
  document.addEventListener('focusin', focusin);
  // AtlasHandPanel already owns Back while retained. Never add a competing entry.
  const retainedPanel = !!document.querySelector('.atlas-sheet-overlay');
  let ownsEntry = false;
  let popped = false;
  const token = `atlas-card-${element.id}`;
  const onBack = () => { popped = true; onClose(); };
  const timer = window.setTimeout(() => {
    if (!retainedPanel) {
      window.history.pushState({ atlasCard: token, previousState: window.history.state }, '');
      ownsEntry = true;
      window.addEventListener('popstate', onBack);
    }
  }, 0);
  return () => {
    window.clearTimeout(timer);
    document.removeEventListener('keydown', keydown);
    document.removeEventListener('focusin', focusin);
    window.removeEventListener('popstate', onBack);
    if (ownsEntry && !popped && window.history.state?.atlasCard === token) window.history.back();
    // Parent retained hand removes inert in its own effect before restoration.
    window.setTimeout(() => {
      if (!nativeOpen() && previous?.isConnected && !previous.closest('[inert]')) previous.focus({ preventScroll: true });
    }, 0);
  };
}

const styles = `
.atlas-card-overlay{position:absolute;inset:0;grid-column:1;grid-row:3 / 5;z-index:125;display:flex;justify-content:center;align-items:center;background:#143d3270;padding:8px;min-height:0;min-width:0}
.atlas-card-dialog[role=dialog]{display:flex;flex-direction:column;width:100%;max-width:42rem;max-height:100%;min-height:0;min-width:0;overflow:hidden;padding:0;border:1px solid #b6cdbd;border-radius:20px;background:#f7faf5;color:#143d32;box-shadow:0 18px 60px #143d3240}
.atlas-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid #d6e2d8;flex-shrink:0;background:white}
.atlas-card-head h2{font-size:18px;font-weight:800;overflow-wrap:anywhere}.atlas-card-head button{flex-shrink:0;border:1px solid #b6cdbd;border-radius:50%;background:white}
.atlas-card-scroll{overflow:auto;overscroll-behavior:contain;min-height:0;padding:16px}.atlas-card-scroll>*+*{margin-top:16px}
.atlas-card-art{display:flex;justify-content:center}.atlas-card-art .md-card{width:min(100%,240px);height:auto;aspect-ratio:9/14;transform:none!important;cursor:default}
.atlas-card-rules{background:#e5eee2;border:1px solid #c1d7c7;border-radius:12px;padding:12px;font-size:14px;line-height:1.6;overflow-wrap:anywhere}.atlas-card-rules h3{font-weight:800}.atlas-card-rules ul{margin-top:8px}
.atlas-card-dialog button,.atlas-card-dialog select,.atlas-card-dialog label:has(input){min-height:44px;min-width:44px}.atlas-card-dialog button{white-space:normal;overflow-wrap:anywhere}.atlas-card-dialog :is(button,select,input):focus-visible{outline:3px solid #995a10;outline-offset:2px}
.atlas-card-dialog .grid{grid-template-columns:repeat(2,minmax(0,1fr))}.atlas-card-dialog .grid button{min-width:0}
.atlas-card-dialog .atlas-card-scroll [class*=text-slate-],.atlas-card-dialog .atlas-card-scroll label{color:#355c4e}.atlas-card-dialog .atlas-card-scroll label{line-height:1.5}
.atlas-card-dialog .atlas-card-scroll button[class*=bg-slate-],.atlas-card-dialog select{background:white;color:#143d32;border:1px solid #a3bfae}
.atlas-card-dialog .atlas-card-scroll button:not([class*=bg-slate-]){background:#08775c;border-color:#075c48;color:white}.atlas-card-dialog button:disabled{opacity:.55}
`;

export function AtlasCardDialog({ card, title, onClose, children }: { card: Card; title: string; onClose: () => void; children?: ReactNode }) {
  const id = useId();
  const panel = useRef<HTMLElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => panel.current ? containAtlasDialog(panel.current, () => close.current()) : undefined, []);
  const kind = card.kind || card.type;
  const property = kind === 'PROPERTY' || kind === 'WILDCARD';
  const colors = card.colors?.filter(color => color !== 'ALL') || (card.color ? [card.color] : []);
  const description = 'description' in card && typeof card.description === 'string' ? card.description : '';
  const rules = ACTION_RULES[card.title || card.name || ''] || (kind === 'RENT'
    ? `Charge rent on one matching property set you own. ${colors.length > 2 ? 'Choose one opponent to pay.' : 'Every opponent pays.'} Rent depends on the number of properties in that set, plus eligible buildings. Payment comes from bank or properties; no change is given.`
    : property ? 'Place in a matching property set. Property cards and wildcards cannot be banked. Wildcards can be moved between eligible sets on your turn without using a play.'
    : kind === 'MONEY' ? 'Deposit in your bank using one play. Banked cards pay debts at their printed value; no change is given.' : 'Choose a legal play below.');
  return <div className="atlas-card-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <style>{styles}</style>
    <section ref={panel} id={id} tabIndex={-1} className="atlas-card-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-rules`}>
      <header className="atlas-card-head"><h2 id={`${id}-title`}>{title}</h2><button type="button" aria-label="Close card dialog" onClick={onClose}>×</button></header>
      <div className="atlas-card-scroll">
        <div className="atlas-card-art"><CardView card={card} size="lg" interactive3d={false} /></div>
        <section className="atlas-card-rules" id={`${id}-rules`}><h3>{card.title || card.name || 'Card'} · {card.value}M</h3>
          {description && <p>{description}</p>}<p>{rules}</p>
          {colors.length > 0 && <p>Colors: {colors.map(humanize).join(', ')}.</p>}
          {(property || kind === 'RENT') && <ul>{colors.map(color => {
            const tiers = ATLAS_RENT_TIERS[color];
            return tiers && <li key={color}><strong>{humanize(color)}</strong> — {tiers.length} cards complete a set. Rent: {tiers.map((rent, index) => `${index + 1} ${index === 0 ? 'card' : 'cards'}: ${rent}M`).join('; ')}.</li>;
          })}</ul>}
        </section>
        {children}
      </div>
    </section>
  </div>;
}
