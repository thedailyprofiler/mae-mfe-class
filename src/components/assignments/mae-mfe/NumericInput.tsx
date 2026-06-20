import { useState } from 'react';

/**
 * Decimal-safe controlled numeric input.
 *
 * Binding an <input value> directly to a number breaks decimal entry: typing
 * "0." round-trips through `Number("0.") === 0`, React re-renders with "0", and
 * the trailing dot vanishes — so you can never reach "0.05". This keeps the raw
 * keystrokes in a local string draft while the field is focused, displays the
 * draft, and commits the parsed number to the parent. On blur the draft is
 * dropped so the field re-syncs to the canonical numeric value.
 */
interface NumericInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: number;
  onCommit: (n: number) => void;
  /** Allow a decimal point (default true). false → integers only. */
  allowDecimal?: boolean;
}

export function NumericInput({
  value,
  onCommit,
  allowDecimal = true,
  onBlur,
  ...rest
}: NumericInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const display = draft ?? (Number.isFinite(value) ? String(value) : '');
  const pattern = allowDecimal ? /^[0-9]*\.?[0-9]*$/ : /^[0-9]*$/;

  return (
    <input
      {...rest}
      type="text"
      inputMode={allowDecimal ? 'decimal' : 'numeric'}
      value={display}
      onChange={(e) => {
        const v = e.target.value;
        if (v !== '' && !pattern.test(v)) return;
        setDraft(v);
        // "" and a lone "." are valid intermediate states → commit 0.
        onCommit(v === '' || v === '.' ? 0 : Number(v));
      }}
      onBlur={(e) => {
        setDraft(null);
        onBlur?.(e);
      }}
    />
  );
}
