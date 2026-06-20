import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { useState } from 'react';
import { NumericInput } from '../NumericInput';

/** Parent-controlled harness mirroring how the dashboard wires NumericInput. */
function Controlled({ initial = 0, allowDecimal = true }: { initial?: number; allowDecimal?: boolean }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <NumericInput value={v} onCommit={setV} allowDecimal={allowDecimal} data-testid="ni" />
      <span data-testid="val">{v}</span>
    </>
  );
}

describe('NumericInput', () => {
  it('lets you type a decimal like 0.05 (the original bug)', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const input = screen.getByTestId('ni') as HTMLInputElement;

    await user.clear(input);
    await user.type(input, '0.05');

    // Before the fix this collapsed to "0" the instant "." was typed.
    expect(input.value).toBe('0.05');
    expect(screen.getByTestId('val')).toHaveTextContent('0.05');
  });

  it('preserves an intermediate trailing dot while editing', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const input = screen.getByTestId('ni') as HTMLInputElement;

    await user.clear(input);
    await user.type(input, '12.');
    expect(input.value).toBe('12.');
    expect(screen.getByTestId('val')).toHaveTextContent('12');
  });

  it('re-syncs to the canonical number on blur', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const input = screen.getByTestId('ni') as HTMLInputElement;

    await user.clear(input);
    await user.type(input, '0.050');
    expect(input.value).toBe('0.050');

    await user.tab();
    expect(input.value).toBe('0.05');
  });

  it('rejects non-numeric characters', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const input = screen.getByTestId('ni') as HTMLInputElement;

    await user.clear(input);
    await user.type(input, 'a1b2');
    expect(input.value).toBe('12');
  });

  it('blocks the decimal point in integer-only mode', async () => {
    const user = userEvent.setup();
    render(<Controlled allowDecimal={false} />);
    const input = screen.getByTestId('ni') as HTMLInputElement;

    await user.clear(input);
    await user.type(input, '1.5');
    expect(input.value).toBe('15');
  });
});
