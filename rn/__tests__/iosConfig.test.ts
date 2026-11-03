/**
 * T6 static config proof. There is no Xcode on this host, so this test is the
 * only automated protection for the plist/entitlements/pbxproj edits: it parses
 * them and asserts the push, ATS, bundle, team, deployment and bridge values
 * match ios/Zot.entitlements + ios/Info.plist + docs/APPID.md.
 *
 * Structure, not occurrence counts. A verifier showed the previous version
 * passing five mutations: both CODE_SIGN_ENTITLEMENTS lines moved to
 * project-level configs, NSExceptionDomains re-parented to the plist root, a
 * PBXFileReference path pointing at a nonexistent file, the @objc(ZotNative)
 * name or the bridge class renamed, and an unrelated PBXFileReference deleted.
 * So: the plists are parsed into real nested values, the four settings are read
 * out of the two app-target buildSettings blocks specifically, every referenced
 * path is checked on disk, and the Swift <-> ObjC bridge names must pair up.
 *
 * Dependency-free on purpose (`plist` is not installed and this must stay
 * offline/jest-fast), hence the small parsers below.
 *
 * @format
 */

import fs from 'node:fs';
import path from 'node:path';

const IOS_DIR = path.join(__dirname, '..', 'ios');
const APP_DIR = path.join(IOS_DIR, 'ZotRN');
const INFO_PLIST = path.join(APP_DIR, 'Info.plist');
const ENTITLEMENTS = path.join(APP_DIR, 'Zot.entitlements');
const PBXPROJ = path.join(IOS_DIR, 'ZotRN.xcodeproj', 'project.pbxproj');
const SWIFT_MODULE = path.join(APP_DIR, 'ZotNative.swift');
const OBJC_BRIDGE = path.join(APP_DIR, 'ZotNativeBridge.m');

function read(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

type PlistValue = string | number | boolean | PlistValue[] | PlistDict;
type PlistDict = { [key: string]: PlistValue };

const UNESCAPE: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
  '&quot;': '"',
  '&apos;': "'",
};

function decodeEntities(text: string): string {
  return text.replace(/&(lt|gt|amp|quot|apos);/g, (_, name: string) => {
    return UNESCAPE['&' + name + ';'];
  });
}

type PlistToken =
  | { kind: 'open'; name: string }
  | { kind: 'close'; name: string }
  | { kind: 'empty'; name: string }
  | { kind: 'text'; text: string };

function tokenizePlist(xml: string): PlistToken[] {
  const cleaned = xml
    .replace(/<\?xml[^>]*\?>/g, '')
    .replace(/<!DOCTYPE[^>]*>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const tokens: PlistToken[] = [];
  const re = /<(\/?)([A-Za-z][\w.-]*)[^>]*?(\/?)>|([^<]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(cleaned)) !== null) {
    const [, closing, name, selfClosing, text] = match;
    if (text !== undefined) {
      if (text.trim() !== '') {
        tokens.push({ kind: 'text', text: decodeEntities(text.trim()) });
      }
      continue;
    }
    if (closing === '/') tokens.push({ kind: 'close', name });
    else if (selfClosing === '/') tokens.push({ kind: 'empty', name });
    else tokens.push({ kind: 'open', name });
  }
  return tokens;
}

/**
 * Parse an XML plist into nested JS values. Only the value types these files
 * use are supported; an unknown tag throws instead of silently returning {}.
 */
function parsePlist(xml: string): PlistDict {
  const tokens = tokenizePlist(xml);
  let index = 0;

  function readText(): string {
    const token = tokens[index];
    if (token === undefined || token.kind !== 'text') return '';
    index += 1;
    return token.text;
  }

  function readDict(): PlistDict {
    const dict: PlistDict = {};
    for (;;) {
      const next = tokens[index];
      if (next === undefined) throw new Error('unterminated <dict>');
      if (next.kind === 'close' && next.name === 'dict') {
        index += 1;
        return dict;
      }
      if (next.kind !== 'open' || next.name !== 'key') {
        throw new Error('dict entry is not a <key>');
      }
      index += 1;
      const key = readText();
      const closingKey = tokens[index];
      if (closingKey === undefined || closingKey.kind !== 'close') {
        throw new Error('unterminated <key>');
      }
      index += 1;
      dict[key] = readValue();
    }
  }

  function readArray(): PlistValue[] {
    const array: PlistValue[] = [];
    for (;;) {
      const next = tokens[index];
      if (next === undefined) throw new Error('unterminated <array>');
      if (next.kind === 'close' && next.name === 'array') {
        index += 1;
        return array;
      }
      array.push(readValue());
    }
  }

  function readValue(): PlistValue {
    const token = tokens[index];
    if (token === undefined) throw new Error('plist ended early');
    if (token.kind === 'text') {
      index += 1;
      return token.text;
    }
    if (token.kind !== 'open' && token.kind !== 'empty') {
      throw new Error('unexpected plist token ' + token.kind);
    }
    index += 1;
    switch (token.name) {
      case 'dict':
        return readDict();
      case 'array':
        return readArray();
      case 'string':
        if (token.kind === 'empty') return '';
        {
          const value = readText();
          const closing = tokens[index];
          if (closing === undefined || closing.kind !== 'close') {
            throw new Error('unterminated <string>');
          }
          index += 1;
          return value;
        }
      case 'integer':
      case 'real': {
        if (token.kind === 'empty') return 0;
        const value = Number(readText());
        const closing = tokens[index];
        if (closing === undefined || closing.kind !== 'close') {
          throw new Error('unterminated <' + token.name + '>');
        }
        index += 1;
        return value;
      }
      case 'true':
      case 'false':
        if (token.kind === 'open') {
          const closing = tokens[index];
          if (closing === undefined || closing.kind !== 'close') {
            throw new Error('unterminated <' + token.name + '>');
          }
          index += 1;
        }
        return token.name === 'true';
      case 'plist':
        // <plist version="1.0"> wraps exactly one value.
        return readValue();
      default:
        throw new Error('unsupported plist tag <' + token.name + '>');
    }
  }

  const root = readValue();
  if (root === null || typeof root !== 'object' || Array.isArray(root)) {
    throw new Error('plist root is not a dict');
  }
  return root;
}

function asDict(value: PlistValue | undefined, label: string): PlistDict {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(label + ' is not a dict');
  }
  return value;
}

const ATS_DOMAINS = [
  '192.168.68.50',
  '192.168.68.56',
  '192.168.68.67',
  '127.0.0.1',
  'localhost',
];

const infoPlist = parsePlist(read(INFO_PLIST));
const entitlements = parsePlist(read(ENTITLEMENTS));
const pbxproj = read(PBXPROJ);

/** XCBuildConfiguration blocks, keyed by their pbxproj UUID. */
type BuildConfig = { id: string; label: string; name: string; body: string };

function parseBuildConfigs(text: string): BuildConfig[] {
  const configs: BuildConfig[] = [];
  const re =
    /^\t\t([0-9A-F]{24}) \/\* ([^*]+) \*\/ = \{\n\t\t\tisa = XCBuildConfiguration;\n([\s\S]*?)\n\t\t\tname = ([A-Za-z0-9]+);\n\t\t\};$/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    configs.push({
      id: match[1],
      label: match[2].trim(),
      name: match[4],
      body: match[3],
    });
  }
  return configs;
}

const buildConfigs = parseBuildConfigs(pbxproj);
// PRODUCT_NAME = ZotRN; is the app target's own marker; the project-level pair
// has no PRODUCT_NAME at all.
const appConfigs = buildConfigs.filter(config =>
  /^\t+PRODUCT_NAME = ZotRN;$/m.test(config.body),
);
const projectConfigs = buildConfigs.filter(
  config => !/^\t+PRODUCT_NAME = ZotRN;$/m.test(config.body),
);

function setting(body: string, key: string): string | null {
  // No dynamic RegExp: line-prefix matching is enough and keeps the lint clean.
  const marker = key + ' = ';
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(marker)) continue;
    const value = trimmed.slice(marker.length);
    if (!value.endsWith(';')) continue;
    return value.slice(0, -1).trim();
  }
  return null;
}

describe('the plists are parseable structures (guard against a silent {})', () => {
  test('Info.plist parses with its documented top-level keys', () => {
    expect(Object.keys(infoPlist).length).toBeGreaterThan(10);
    expect(infoPlist.CFBundleDisplayName).toBe('Zot');
    expect(infoPlist.LSRequiresIPhoneOS).toBe(true);
    expect(infoPlist.RCTNewArchEnabled).toBe(true);
  });

  test('Zot.entitlements parses as a dict', () => {
    expect(Object.keys(entitlements)).toContain('aps-environment');
  });

  test('pbxproj yields four build configurations, two of them the app target', () => {
    expect(buildConfigs).toHaveLength(4);
    expect(appConfigs.map(config => config.name).sort()).toEqual([
      'Debug',
      'Release',
    ]);
    expect(projectConfigs.map(config => config.name).sort()).toEqual([
      'Debug',
      'Release',
    ]);
    // The app pair is the 13B07F94/13B07F95 configs on target ZotRN.
    expect(appConfigs.map(config => config.id).sort()).toEqual([
      '13B07F941A680F5B00A75B9A',
      '13B07F951A680F5B00A75B9A',
    ]);
  });
});

describe('push entitlement (ios/Zot.entitlements)', () => {
  test('the app carries aps-environment development', () => {
    expect(entitlements['aps-environment']).toBe('development');
  });

  test('CODE_SIGN_ENTITLEMENTS is inside both app-target buildSettings', () => {
    for (const config of appConfigs) {
      expect(setting(config.body, 'CODE_SIGN_ENTITLEMENTS')).toBe(
        'ZotRN/Zot.entitlements',
      );
    }
    // Mutation guard: hoisting it to project-level configs is not the same thing.
    for (const config of projectConfigs) {
      expect(setting(config.body, 'CODE_SIGN_ENTITLEMENTS')).toBe(null);
    }
  });

  test('the entitlements file the build points at exists', () => {
    expect(fs.existsSync(path.join(IOS_DIR, 'ZotRN/Zot.entitlements'))).toBe(
      true,
    );
    expect(fs.existsSync(ENTITLEMENTS)).toBe(true);
  });
});

describe('ATS exceptions (ios/Info.plist:5-37)', () => {
  const ats = asDict(
    infoPlist.NSAppTransportSecurity,
    'NSAppTransportSecurity',
  );

  test('the ATS block keeps arbitrary loads false and local networking on', () => {
    expect(ats.NSAllowsArbitraryLoads).toBe(false);
    expect(ats.NSAllowsLocalNetworking).toBe(true);
    // Mutation guard: these belong to the ATS dict, not the plist root.
    expect(infoPlist.NSAllowsArbitraryLoads).toBeUndefined();
    expect(infoPlist.NSAllowsLocalNetworking).toBeUndefined();
  });

  test('all five LAN/localhost exception domains nest under NSExceptionDomains', () => {
    const domains = asDict(ats.NSExceptionDomains, 'NSExceptionDomains');
    expect(Object.keys(domains).sort()).toEqual([...ATS_DOMAINS].sort());
    for (const domain of ATS_DOMAINS) {
      expect(domains[domain]).toEqual({
        NSTemporaryExceptionAllowsInsecureHTTPLoads: true,
      });
    }
    // Mutation guard: re-parenting NSExceptionDomains to the root is a
    // different (and non-functional) plist, even with the same key present.
    expect(infoPlist.NSExceptionDomains).toBeUndefined();
    expect(
      infoPlist.NSTemporaryExceptionAllowsInsecureHTTPLoads,
    ).toBeUndefined();
  });

  test('the display name is Zot and the module name stays ZotRN', () => {
    expect(infoPlist.CFBundleDisplayName).toBe('Zot');
    expect(infoPlist.CFBundleName).toBe('$(PRODUCT_NAME)');
    expect(pbxproj).toContain('name = ZotRN;');
  });
});

describe('bundle, team, deployment target (docs/APPID.md)', () => {
  test('the app bundle id is com.zanishlabs.zot in both app configs', () => {
    for (const config of appConfigs) {
      expect(setting(config.body, 'PRODUCT_BUNDLE_IDENTIFIER')).toBe(
        'com.zanishlabs.zot',
      );
    }
    for (const config of projectConfigs) {
      expect(setting(config.body, 'PRODUCT_BUNDLE_IDENTIFIER')).toBe(null);
    }
    expect(pbxproj).not.toContain('org.reactjs.native.example');
  });

  test('the team is 36V92GAJBT in both app configs', () => {
    for (const config of appConfigs) {
      expect(setting(config.body, 'DEVELOPMENT_TEAM')).toBe('36V92GAJBT');
    }
    for (const config of projectConfigs) {
      expect(setting(config.body, 'DEVELOPMENT_TEAM')).toBe(null);
    }
  });

  test('deployment target is 17.0 in all four configs', () => {
    for (const config of buildConfigs) {
      expect(setting(config.body, 'IPHONEOS_DEPLOYMENT_TARGET')).toBe('17.0');
    }
    expect(pbxproj).not.toContain('IPHONEOS_DEPLOYMENT_TARGET = 15.1;');
  });

  test('the Info.plist the app configs point at exists', () => {
    for (const config of appConfigs) {
      expect(setting(config.body, 'INFOPLIST_FILE')).toBe('ZotRN/Info.plist');
    }
    expect(fs.existsSync(INFO_PLIST)).toBe(true);
  });
});

describe('every referenced source path exists on disk', () => {
  type FileRef = { id: string; path: string; sourceTree: string };

  const refs: FileRef[] = [];
  for (const line of pbxproj.split('\n')) {
    if (!line.includes('isa = PBXFileReference;')) continue;
    const id = /^\t\t([0-9A-F]{24}) /.exec(line);
    const filePath = /path = (?:"([^"]+)"|([^;]+));/.exec(line);
    const tree = /sourceTree = (?:"([^"]+)"|([^;]+));/.exec(line);
    if (id === null || filePath === null || tree === null) continue;
    refs.push({
      id: id[1],
      path: (filePath[1] ?? filePath[2]).trim(),
      sourceTree: (tree[1] ?? tree[2]).trim(),
    });
  }

  test('the file-reference table parses', () => {
    expect(refs.length).toBeGreaterThan(8);
  });

  test('group-relative references resolve to real files and folders', () => {
    const checked: string[] = [];
    for (const ref of refs) {
      // Only group/root-relative paths are this repo's own files; build
      // products, SDK frameworks and Pods xcconfigs live outside it.
      if (ref.sourceTree !== '<group>' && ref.sourceTree !== 'SOURCE_ROOT') {
        continue;
      }
      if (ref.path.startsWith('Target Support Files/')) continue;
      expect(fs.existsSync(path.join(IOS_DIR, ref.path))).toBe(true);
      checked.push(ref.path);
    }
    // Mutation guard: pointing path = ZotRN/ZotNative.swift at a missing file
    // must fail, and these files must actually be in the checked set.
    for (const required of [
      'ZotRN/ZotNative.swift',
      'ZotRN/ZotNativeBridge.m',
      'ZotRN/Zot.entitlements',
      'ZotRN/Info.plist',
      'ZotRN/AppDelegate.swift',
      'ZotRN/SceneDelegate.swift',
    ]) {
      expect(checked).toContain(required);
    }
  });

  test('the Swift and ObjC bridge files are compiled by the app target', () => {
    for (const config of appConfigs) {
      expect(setting(config.body, 'PRODUCT_NAME')).toBe('ZotRN');
    }
    const buildFiles = pbxproj
      .split('\n')
      .filter(line => line.includes('isa = PBXBuildFile;'));
    for (const source of [
      'ZotNative.swift',
      'ZotNativeBridge.m',
      'AppDelegate.swift',
      'SceneDelegate.swift',
    ]) {
      const line = buildFiles.find(entry =>
        entry.includes('/* ' + source + ' in Sources */'),
      );
      expect(line).toBeDefined();
      // A build file entry must be a real object with a pbxproj UUID.
      expect(/^\t\t[0-9A-F]{24} /.test(line ?? '')).toBe(true);
    }
  });
});

describe('the Swift module and the ObjC bridge agree on names', () => {
  const swift = read(SWIFT_MODULE);
  const bridge = read(OBJC_BRIDGE);

  test('the @objc name matches the RCT_EXTERN_MODULE name', () => {
    const objcName =
      /@objc\((\w+)\)\s*\n\s*final class (\w+): RCTEventEmitter/.exec(swift);
    expect(objcName).not.toBe(null);
    // The ObjC-visible name is what NativeModules.ZotNative resolves.
    expect(objcName?.[1]).toBe('ZotNative');
    expect(objcName?.[2]).toBe('ZotNative');

    const externModule = /RCT_EXTERN_MODULE\((\w+), *(\w+)\)/.exec(bridge);
    expect(externModule).not.toBe(null);
    expect(externModule?.[1]).toBe(objcName?.[1]);
    // RCTEventEmitter is what makes NativeEventEmitter work for zotPushToken.
    expect(externModule?.[2]).toBe('RCTEventEmitter');
  });

  test('each @objc(selector:) matches its func name', () => {
    const selectors: string[] = [];
    const re = /@objc\((\w+):[^)]*rejecter:[^)]*\)\s*\n\s*func (\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(swift)) !== null) {
      // ObjC selectors derive from the first parameter label, which must be the
      // Swift func name or the bridge call cannot resolve.
      expect(match[1]).toBe(match[2]);
      selectors.push(match[2]);
    }
    expect(selectors.sort()).toEqual([
      'getStashedPushToken',
      'requestPushRegistration',
    ]);
  });

  test('RCT_EXTERN_METHOD exports exactly the selectors the Swift module declares', () => {
    const exported: string[] = [];
    const re = /RCT_EXTERN_METHOD\((\w+):/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(bridge)) !== null) exported.push(match[1]);
    expect(exported.sort()).toEqual([
      'getStashedPushToken',
      'requestPushRegistration',
    ]);
  });
});

describe('pbxproj object graph is intact', () => {
  const definition = /^\t\t([0-9A-F]{24})(?: \/\*[^*]*\*\/)? = \{/gm;
  const defined = new Map<string, number>();
  let match: RegExpExecArray | null;
  while ((match = definition.exec(pbxproj)) !== null) {
    defined.set(match[1], (defined.get(match[1]) ?? 0) + 1);
  }

  test('there are no duplicate object ids', () => {
    const duplicates = [...defined.entries()].filter(([, count]) => count > 1);
    expect(duplicates).toEqual([]);
  });

  test('every referenced id resolves to an object in this file', () => {
    const referenced = new Set(
      (pbxproj.match(/\b[0-9A-F]{24}\b/g) ?? []).filter(id =>
        /^[0-9A-F]{24}$/.test(id),
      ),
    );
    // Mutation guard: deleting a PBXFileReference leaves its references behind.
    const dangling = [...referenced].filter(id => !defined.has(id));
    expect(dangling).toEqual([]);
  });

  test('braces still balance (cheap parse sanity)', () => {
    const braces = (text: string): number => text.split('{').length - 1;
    expect(braces(pbxproj)).toBe(pbxproj.split('}').length - 1);
    expect(pbxproj.split('(').length).toBe(pbxproj.split(')').length);
  });
});
