import { render, screen, fireEvent } from '@testing-library/react';
import { HELP, HELP_GROUPS } from '../helpContent';
import { InfoTip } from '../InfoTip';
import { HelpPanel } from '../HelpPanel';

describe('helpContent registry', () => {
  it('every group item has a non-empty id, term, and body', () => {
    for (const g of HELP_GROUPS) {
      expect(g.title).toBeTruthy();
      for (const it of g.items) {
        expect(it.id).toBeTruthy();
        expect(it.term.length).toBeGreaterThan(0);
        expect(it.body.length).toBeGreaterThan(10);
      }
    }
  });

  it('ids are unique and the flat HELP map covers every item', () => {
    const ids = HELP_GROUPS.flatMap((g) => g.items.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length); // unique
    for (const id of ids) expect(HELP[id]).toBeDefined();
  });

  it('covers the key trading-jargon terms', () => {
    for (const id of ['mae', 'mfe', 'minCashflow', 'evMatrix', 'gap', 'size', 'study', 'attempts', 'cycleLab', 'compareLab']) {
      expect(HELP[id]).toBeDefined();
    }
  });
});

describe('InfoTip', () => {
  it('renders an accessible help affordance and reveals the tooltip on click', () => {
    render(<InfoTip id="mae" />);
    const btn = screen.getByTestId('mae-mfe-info-mae');
    expect(btn).toHaveAttribute('aria-label', expect.stringContaining('MAE'));
    fireEvent.click(btn);
    // Tooltip (portal) shows the body text.
    expect(screen.getByRole('tooltip')).toHaveTextContent(/adverse excursion/i);
  });

  it('renders nothing when the id is unknown and no text is given', () => {
    const { container } = render(<InfoTip id="does_not_exist" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('HelpPanel', () => {
  it('opens a glossary dialog listing the group titles', () => {
    render(<HelpPanel />);
    fireEvent.click(screen.getByTestId('mae-mfe-help-toggle'));
    const panel = screen.getByTestId('mae-mfe-help-panel');
    expect(panel).toHaveTextContent('Core concepts');
    expect(panel).toHaveTextContent('Account cycling lab');
  });
});
