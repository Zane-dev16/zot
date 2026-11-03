#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

// ObjC shim so the Swift ZotNative class registers as a legacy bridge module.
// addListener/removeListeners come from RCTEventEmitter itself, which is what
// NativeEventEmitter calls on the JS side.
@interface RCT_EXTERN_MODULE(ZotNative, RCTEventEmitter)

RCT_EXTERN_METHOD(requestPushRegistration:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getStashedPushToken:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
