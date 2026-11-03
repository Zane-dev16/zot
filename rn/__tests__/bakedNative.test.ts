/**
 * T5 baked pair native adapter: ios/BakedPair.swift precedence plus the
 * setBakedPairSource registration the app entry performs at startup.
 *
 * @format
 */

import {
  createBakedOnceGuard,
  getBakedPairSource,
  readBakedPairConfig,
  setBakedPairSource,
} from '../src/api/baked';
import {
  BAKED_CODE_FLAG,
  BAKED_FLAG,
  BAKED_SERVER_FLAG,
  bakedConfigFromLaunch,
  createBakedPairSource,
  isBakedLaunch,
  launchValue,
  registerNativeBakedPairSource,
} from '../src/api/bakedNative';
import type { ZotLaunchInfo } from '../src/api/zotNative';
import { isValidPairCode } from '../src/session/validation';

function launch(
  arguments_: string[] = [],
  environment: Record<string, string> = {},
): ZotLaunchInfo {
  return { arguments: arguments_, environment };
}

const SERVER = '192.168.68.56:8787';
const CODE = '123456';

afterEach(() => {
  setBakedPairSource(null);
});

describe('baked flag (ios/BakedPair.swift:11-15)', () => {
  test('argv -ZOT_BAKED turns the flavor on without a value', () => {
    expect(isBakedLaunch(launch([BAKED_FLAG]))).toBe(true);
  });

  test('env ZOT_BAKED must be exactly "1"', () => {
    expect(isBakedLaunch(launch([], { ZOT_BAKED: '1' }))).toBe(true);
    expect(isBakedLaunch(launch([], { ZOT_BAKED: 'true' }))).toBe(false);
    expect(isBakedLaunch(launch([], { ZOT_BAKED: '0' }))).toBe(false);
  });

  test('a normal launch is not baked', () => {
    expect(isBakedLaunch(launch(['-AppleLanguages', '(en)']))).toBe(false);
  });
});

describe('value precedence: -flag value, -flag=value, env', () => {
  test('the pair form wins over the equals form and the env', () => {
    const info = launch(
      [BAKED_SERVER_FLAG, 'from-pair', BAKED_SERVER_FLAG + '=from-equals'],
      { ZOT_SERVER_URL: 'from-env' },
    );
    expect(launchValue(BAKED_SERVER_FLAG, 'ZOT_SERVER_URL', info)).toBe(
      'from-pair',
    );
  });

  test('the equals form wins over the env', () => {
    const info = launch([BAKED_CODE_FLAG + '=from-equals'], {
      ZOT_PAIR_CODE: 'from-env',
    });
    expect(launchValue(BAKED_CODE_FLAG, 'ZOT_PAIR_CODE', info)).toBe(
      'from-equals',
    );
  });

  test('env is the last resort', () => {
    const info = launch([], { ZOT_PAIR_CODE: 'from-env' });
    expect(launchValue(BAKED_CODE_FLAG, 'ZOT_PAIR_CODE', info)).toBe(
      'from-env',
    );
  });

  test('a trailing flag with no value falls through to env', () => {
    const info = launch([BAKED_SERVER_FLAG], {
      ZOT_SERVER_URL: 'from-env',
    });
    expect(launchValue(BAKED_SERVER_FLAG, 'ZOT_SERVER_URL', info)).toBe(
      'from-env',
    );
  });

  test('missing everywhere is null', () => {
    expect(launchValue(BAKED_CODE_FLAG, 'ZOT_PAIR_CODE', launch())).toBe(null);
  });

  test('the equals form may be empty (config rejects it later)', () => {
    const info = launch([BAKED_CODE_FLAG + '=']);
    expect(launchValue(BAKED_CODE_FLAG, 'ZOT_PAIR_CODE', info)).toBe('');
  });
});

describe('bakedConfigFromLaunch (ios/BakedPair.swift:16-23)', () => {
  test('argv pair form builds the config', () => {
    const info = launch([
      BAKED_FLAG,
      BAKED_SERVER_FLAG,
      SERVER,
      BAKED_CODE_FLAG,
      CODE,
    ]);
    expect(bakedConfigFromLaunch(info)).toEqual({
      serverURL: SERVER,
      code: CODE,
    });
  });

  test('argv equals form builds the config', () => {
    const info = launch([
      BAKED_FLAG,
      BAKED_SERVER_FLAG + '=' + SERVER,
      BAKED_CODE_FLAG + '=' + CODE,
    ]);
    expect(bakedConfigFromLaunch(info)).toEqual({
      serverURL: SERVER,
      code: CODE,
    });
  });

  test('env-only launch builds the config', () => {
    const info = launch([], {
      ZOT_BAKED: '1',
      ZOT_SERVER_URL: SERVER,
      ZOT_PAIR_CODE: CODE,
    });
    expect(bakedConfigFromLaunch(info)).toEqual({
      serverURL: SERVER,
      code: CODE,
    });
  });

  test('not baked -> null even with both values present', () => {
    const info = launch([], {
      ZOT_SERVER_URL: SERVER,
      ZOT_PAIR_CODE: CODE,
    });
    expect(bakedConfigFromLaunch(info)).toBe(null);
  });

  test('missing server or missing code -> null', () => {
    expect(
      bakedConfigFromLaunch(launch([BAKED_FLAG, BAKED_CODE_FLAG, CODE])),
    ).toBe(null);
    expect(
      bakedConfigFromLaunch(launch([BAKED_FLAG, BAKED_SERVER_FLAG, SERVER])),
    ).toBe(null);
  });

  test('an empty value is treated as missing, like the Swift guard', () => {
    expect(
      bakedConfigFromLaunch(
        launch([BAKED_FLAG, BAKED_SERVER_FLAG + '=', BAKED_CODE_FLAG, CODE]),
      ),
    ).toBe(null);
  });

  test('a non-numeric code passes the adapter but fails the 6-digit gate', () => {
    const config = bakedConfigFromLaunch(
      launch([
        BAKED_FLAG,
        BAKED_SERVER_FLAG,
        SERVER,
        BAKED_CODE_FLAG,
        'abc123',
      ]),
    );
    expect(config).toEqual({ serverURL: SERVER, code: 'abc123' });
    expect(isValidPairCode(config === null ? '' : config.code)).toBe(false);
  });
});

describe('registration through setBakedPairSource (T5 hook point)', () => {
  test('registers a source that readBakedPairConfig consumes', () => {
    setBakedPairSource(null);
    expect(readBakedPairConfig()).toBe(null);

    const source = registerNativeBakedPairSource(
      launch([
        BAKED_FLAG,
        BAKED_SERVER_FLAG,
        SERVER + '/',
        BAKED_CODE_FLAG,
        CODE,
      ]),
    );
    expect(source).not.toBe(null);
    expect(getBakedPairSource()).toBe(source);
    expect(readBakedPairConfig()).toEqual({
      serverURL: 'http://' + SERVER,
      code: CODE,
    });
  });

  test('a non-baked launch registers a source that stays inert', () => {
    registerNativeBakedPairSource(
      launch(['-AppleLanguages', '(en)'], { ZOT_BAKED: '0' }),
    );
    expect(getBakedPairSource()).not.toBe(null);
    expect(readBakedPairConfig()).toBe(null);
  });

  test('no native module/launch info leaves the seam untouched', () => {
    expect(registerNativeBakedPairSource(null)).toBe(null);
    expect(getBakedPairSource()).toBe(null);
  });

  test('createBakedPairSource mirrors the config function', () => {
    const source = createBakedPairSource(
      launch([BAKED_FLAG, BAKED_SERVER_FLAG, SERVER, BAKED_CODE_FLAG, CODE]),
    );
    expect(source.isBaked).toBe(true);
    expect(source.config()).toEqual({ serverURL: SERVER, code: CODE });
  });

  test('the once-guard still limits a registered source to one run', () => {
    registerNativeBakedPairSource(
      launch([BAKED_FLAG, BAKED_SERVER_FLAG, SERVER, BAKED_CODE_FLAG, CODE]),
    );
    const guard = createBakedOnceGuard();
    expect(guard.shouldRun()).toBe(true);
    expect(readBakedPairConfig()).not.toBe(null);
    expect(guard.shouldRun()).toBe(false);
  });
});
