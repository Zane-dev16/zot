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

  test('counts astral characters like Swift prefix(40), not UTF-16 units', () => {
    // 30 emoji = 60 UTF-16 units but 30 Characters, so Swift keeps all 30.
    const emoji = '\u{1F680}'.repeat(30);
    expect(emoji.length).toBe(60);
    const short = deriveRunTitle(emoji);
    expect(Array.from(short)).toHaveLength(30);
    expect(short).toBe(emoji);

    // 41 astral chars: cut at 40 code points, never through the middle of one.
    const longer = '\u{1F680}'.repeat(41);
    const cut = deriveRunTitle(longer);
    expect(Array.from(cut)).toHaveLength(RUN_TITLE_MAX);
    expect(cut.length).toBe(RUN_TITLE_MAX * 2);
    // encodeURIComponent throws URIError on a lone surrogate.
    expect(() => encodeURIComponent(cut)).not.toThrow();
    expect(cut).toBe('\u{1F680}'.repeat(40));
  });

  test('a BMP prompt over the cap still cuts at 40 characters', () => {
    const long = '\u00e9'.repeat(50);
    const cut = deriveRunTitle(long);
    expect(cut).toBe('\u00e9'.repeat(40));
    expect(cut.length).toBe(40);
  });
});
