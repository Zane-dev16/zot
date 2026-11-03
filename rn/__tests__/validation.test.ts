import {
  deriveRunTitle,
  isValidPairCode,
  normalizePairCode,
  PAIR_CODE_ERROR,
  RUN_TITLE_MAX,
} from '../src/session/validation';

describe('pair code gate (ios/ContentView.swift:78-85)', () => {
  test('accepts exactly six digits, trimming whitespace', () => {
    expect(isValidPairCode('123456')).toBe(true);
    expect(isValidPairCode('  123456\n')).toBe(true);
    expect(isValidPairCode('000000')).toBe(true);
  });

  test('rejects anything else with the documented error line', () => {
    expect(isValidPairCode('12345')).toBe(false);
    expect(isValidPairCode('1234567')).toBe(false);
    expect(isValidPairCode('12 456')).toBe(false);
    expect(isValidPairCode('12ab56')).toBe(false);
    expect(isValidPairCode('-12345')).toBe(false);
    expect(isValidPairCode('')).toBe(false);
    expect(PAIR_CODE_ERROR).toBe('Code must be 6 digits.');
  });

  test('normalizes with a trim only, never stripping digits', () => {
    expect(normalizePairCode(' 123456 ')).toBe('123456');
  });
});

describe('composer title (ios/ContentView.swift:120)', () => {
  test('derives the title from the prompt prefix', () => {
    expect(deriveRunTitle('  deploy the thing  ')).toBe('deploy the thing');
    expect(deriveRunTitle('')).toBe('');
  });

  test('caps the derived title at 40 characters', () => {
    const long = 'a'.repeat(60);
    expect(deriveRunTitle(long)).toHaveLength(RUN_TITLE_MAX);
    expect(deriveRunTitle(long)).toBe('a'.repeat(40));
  });
});
