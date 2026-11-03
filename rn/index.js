/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { registerNativeBakedPairSource } from './src/api/bakedNative';

// Baked pair flavor (ios/BakedPair.swift): register the native launch args/env
// before the first render so App's once-guard sees the source synchronously.
// Off-device (jest) there is no NativeModules.ZotNative, so this is a no-op.
registerNativeBakedPairSource();

AppRegistry.registerComponent(appName, () => App);
