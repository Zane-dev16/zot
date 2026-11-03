/**
 * Zot RN client entry. Pair screen until a token is in the keychain, then the
 * run list + composer. Ports ios/ContentView.swift:12-127.
 *
 * @format
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar, StyleSheet, useColorScheme, View } from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import { createBakedOnceGuard, readBakedPairConfig } from './src/api/baked.ts';
import { PairScreen } from './src/screens/PairScreen.tsx';
import { RunsScreen } from './src/screens/RunsScreen.tsx';
import type { SessionDeps } from './src/session/SessionProvider.tsx';
import {
  SessionProvider,
  useSessionState,
} from './src/session/SessionProvider.tsx';

export type AppProps = {
  deps?: SessionDeps;
};

function ZotRoot(): React.ReactElement {
  const { session, state } = useSessionState();
  const insets = useSafeAreaInsets();
  const [host, setHost] = useState(state.host);
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const bakedGuard = useRef(createBakedOnceGuard());

  // The controller's host can change under the pair field: hydrate() restores
  // the persisted host, and signOut() resets it to the default. Follow those
  // changes only while the user has not typed, so an edit is never clobbered
  // mid-pair. Before this the field kept whatever state.host was at first
  // render, so a stored host never showed when the token failed to load (the
  // wildcard-signing case: keychain item unreadable, host still persisted).
  const syncedHost = useRef(state.host);
  useEffect(() => {
    const previous = syncedHost.current;
    if (state.host === previous) return;
    syncedHost.current = state.host;
    setHost(current => (current === previous ? state.host : current));
  }, [state.host]);

  // Baked pair hook (ios/ContentView.swift:68-76): the native launch-args source
  // is registered at startup by registerNativeBakedPairSource() in index.js:13,
  // so this sees a source whenever the app was launched baked. At most one
  // attempt per app session, and never over an existing token.
  useEffect(() => {
    if (!state.hydrated) return;
    if (state.token !== null) return;
    if (!bakedGuard.current.shouldRun()) return;
    const config = readBakedPairConfig();
    if (config === null) return;
    setHost(config.serverURL);
    setCode(config.code);
    session.pair(config.serverURL, config.code).catch(() => {});
  }, [session, state.hydrated, state.token]);

  const onPair = useCallback(() => {
    session.pair(host, code).catch(() => {});
  }, [code, host, session]);

  const onSend = useCallback(() => {
    if (prompt.trim() === '') return;
    const nextPrompt = prompt;
    setPrompt('');
    setTitle('');
    session.send(title, nextPrompt).catch(() => {});
  }, [prompt, session, title]);

  const onRefresh = useCallback(() => {
    session.refresh().catch(() => {});
  }, [session]);

  const onUnpair = useCallback(() => {
    setCode('');
    setTitle('');
    setPrompt('');
    session.signOut().catch(() => {});
  }, [session]);

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      {!state.hydrated ? null : state.token === null ? (
        <PairScreen
          host={host}
          code={code}
          error={state.error}
          busy={state.busy}
          onChangeHost={setHost}
          onChangeCode={setCode}
          onPair={onPair}
        />
      ) : (
        <RunsScreen
          runs={state.runs}
          error={state.error}
          status={state.status}
          title={title}
          prompt={prompt}
          busy={state.busy}
          onChangeTitle={setTitle}
          onChangePrompt={setPrompt}
          onSend={onSend}
          onRefresh={onRefresh}
          onUnpair={onUnpair}
        />
      )}
    </View>
  );
}

function App(props: AppProps): React.ReactElement {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <SessionProvider deps={props.deps}>
        <ZotRoot />
      </SessionProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

export default App;
