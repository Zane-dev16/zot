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

  // Baked pair hook (ios/ContentView.swift:68-76): inert until T5 registers a
  // native launch-args source; at most one attempt per app session.
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
      {state.token === null ? (
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
