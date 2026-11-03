/**
 * T6 static config proof. There is no Xcode on this host, so this test is the
 * only automated protection for the plist/entitlements/pbxproj edits: it reads
 * them as text and asserts the push, ATS, bundle, team and deployment values
 * match ios/Zot.entitlements + ios/Info.plist + docs/APPID.md.
 *
 * @format
 */

import fs from 'node:fs';
import path from 'node:path';

const IOS_DIR = path.join(__dirname, '..', 'ios');
const INFO_PLIST = path.join(IOS_DIR, 'ZotRN', 'Info.plist');
const ENTITLEMENTS = path.join(IOS_DIR, 'ZotRN', 'Zot.entitlements');
const PBXPROJ = path.join(IOS_DIR, 'ZotRN.xcodeproj', 'project.pbxproj');

function read(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const infoPlist = read(INFO_PLIST);
const entitlements = read(ENTITLEMENTS);
const pbxproj = read(PBXPROJ);

const ATS_DOMAINS = [
  '192.168.68.50',
  '192.168.68.56',
  '192.168.68.67',
  '127.0.0.1',
  'localhost',
];

describe('push entitlement (ios/Zot.entitlements)', () => {
  test('the app carries aps-environment development', () => {
    expect(entitlements).toMatch(
      /<key>aps-environment<\/key>\s*<string>development<\/string>/,
    );
  });

  test('CODE_SIGN_ENTITLEMENTS points at it in Debug and Release', () => {
    expect(
      occurrences(pbxproj, 'CODE_SIGN_ENTITLEMENTS = ZotRN/Zot.entitlements;'),
    ).toBe(2);
    expect(pbxproj).toContain('path = ZotRN/Zot.entitlements;');
  });
});

describe('ATS exceptions (ios/Info.plist:5-37)', () => {
  test('all five LAN/localhost exception domains are present', () => {
    for (const domain of ATS_DOMAINS) {
      expect(infoPlist).toContain(`<key>${domain}</key>`);
    }
    expect(
      occurrences(
        infoPlist,
        '<key>NSTemporaryExceptionAllowsInsecureHTTPLoads</key>',
      ),
    ).toBe(5);
  });

  test('arbitrary loads stay false and local networking stays on', () => {
    expect(infoPlist).toMatch(
      /<key>NSAllowsArbitraryLoads<\/key>\s*<false\/>/,
    );
    expect(infoPlist).toMatch(/<key>NSAllowsLocalNetworking<\/key>\s*<true\/>/);
  });

  test('the display name is Zot, the target/module name is untouched', () => {
    expect(infoPlist).toMatch(
      /<key>CFBundleDisplayName<\/key>\s*<string>Zot<\/string>/,
    );
    expect(pbxproj).toContain('name = ZotRN;');
    expect(pbxproj).toContain('PRODUCT_NAME = ZotRN;');
  });
});

describe('bundle, team, deployment target (docs/APPID.md)', () => {
  test('the app bundle id is com.zanishlabs.zot in both app configs', () => {
    expect(
      occurrences(pbxproj, 'PRODUCT_BUNDLE_IDENTIFIER = com.zanishlabs.zot;'),
    ).toBe(2);
    expect(pbxproj).not.toContain('org.reactjs.native.example');
  });

  test('the team is 36V92GAJBT in both app configs', () => {
    expect(occurrences(pbxproj, 'DEVELOPMENT_TEAM = 36V92GAJBT;')).toBe(2);
  });

  test('deployment target is 17.0 everywhere, including the app configs', () => {
    expect(occurrences(pbxproj, 'IPHONEOS_DEPLOYMENT_TARGET = 17.0;')).toBe(4);
    expect(pbxproj).not.toContain('IPHONEOS_DEPLOYMENT_TARGET = 15.1;');
  });
});

describe('native bridge build membership', () => {
  test('ZotNative.swift is compiled by the ZotRN target', () => {
    expect(pbxproj).toContain(
      'ZotNative.swift in Sources */ = {isa = PBXBuildFile',
    );
    expect(pbxproj).toContain(
      '7A1000000000000000000001 /* ZotNative.swift in Sources */,',
    );
  });

  test('ZotNativeBridge.m is compiled by the ZotRN target', () => {
    expect(pbxproj).toContain(
      'ZotNativeBridge.m in Sources */ = {isa = PBXBuildFile',
    );
    expect(pbxproj).toContain(
      '7A1000000000000000000003 /* ZotNativeBridge.m in Sources */,',
    );
  });

  test('the pbxproj braces stay balanced', () => {
    expect(occurrences(pbxproj, '{')).toBe(occurrences(pbxproj, '}'));
    expect(occurrences(pbxproj, '(')).toBe(occurrences(pbxproj, ')'));
  });
});
