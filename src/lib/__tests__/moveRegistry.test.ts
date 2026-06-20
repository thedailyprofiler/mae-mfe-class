import {
  BUILTIN_MOVES,
  DEFAULT_MOVE_DEFS,
  DEFAULT_MOVE_ORDER,
  getMoveLabel,
  getMoveWeekdays,
  isBuiltinMove,
} from '../moveRegistry';

describe('moveRegistry', () => {
  it('exposes the four built-in moves in order', () => {
    expect(DEFAULT_MOVE_ORDER).toEqual(['1800', '0300', 'MO', 'LB']);
    expect(BUILTIN_MOVES).toHaveLength(4);
  });

  it('isBuiltinMove distinguishes built-ins from custom ids', () => {
    expect(isBuiltinMove('1800')).toBe(true);
    expect(isBuiltinMove('MO')).toBe(true);
    expect(isBuiltinMove('mv_custom')).toBe(false);
  });

  describe('getMoveLabel', () => {
    it('returns built-in labels', () => {
      expect(getMoveLabel('1800')).toBe('1800');
      expect(getMoveLabel('MO')).toBe('Market Open');
      expect(getMoveLabel('LB')).toBe('Lunch Break');
    });

    it('prefers a document-provided def label for custom moves', () => {
      const defs = { mv_x: { ...DEFAULT_MOVE_DEFS['1800'], id: 'mv_x', label: 'My Open', builtin: false } };
      expect(getMoveLabel('mv_x', defs)).toBe('My Open');
    });

    it('falls back to the id itself for an unknown move', () => {
      expect(getMoveLabel('mv_unknown')).toBe('mv_unknown');
    });
  });

  describe('getMoveWeekdays', () => {
    it('returns built-in weekday sets (1800 = Sun–Thu, others Mon–Fri)', () => {
      expect(getMoveWeekdays('1800')).toEqual([0, 1, 2, 3, 4]);
      expect(getMoveWeekdays('0300')).toEqual([1, 2, 3, 4, 5]);
    });

    it('honors a custom def, else falls back to Mon–Fri', () => {
      const defs = { mv_sun: { id: 'mv_sun', label: 'Sun', builtin: false, weekdays: [0] } };
      expect(getMoveWeekdays('mv_sun', defs)).toEqual([0]);
      expect(getMoveWeekdays('mv_unregistered')).toEqual([1, 2, 3, 4, 5]);
    });
  });
});
