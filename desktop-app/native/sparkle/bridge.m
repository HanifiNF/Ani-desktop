#import <AppKit/AppKit.h>
#import <Sparkle/Sparkle.h>
#include <node_api.h>

// Electron calls this addon on the Cocoa main thread after app.whenReady().
// Sparkle owns its standard UI and the authenticated install/relaunch protocol.
static SPUStandardUpdaterController *controller;

static napi_value Check(napi_env env, napi_callback_info info) {
    @autoreleasepool {
        if (![NSThread isMainThread]) {
            napi_throw_error(env, NULL, "Sparkle requires the main thread.");
            return NULL;
        }
        @try {
            if (controller == nil) {
                controller = [[SPUStandardUpdaterController alloc]
                    initWithStartingUpdater:NO updaterDelegate:nil userDriverDelegate:nil];
                [controller.updater clearFeedURLFromUserDefaults];
                controller.updater.automaticallyChecksForUpdates = NO;
                controller.updater.automaticallyDownloadsUpdates = NO;
                NSError *error = nil;
                if (![controller.updater startUpdater:&error]) {
                    controller = nil;
                    napi_throw_error(env, NULL, error.localizedDescription.UTF8String);
                    return NULL;
                }
            }
            [controller checkForUpdates:nil];
        } @catch (NSException *exception) {
            napi_throw_error(env, NULL, exception.reason.UTF8String);
            return NULL;
        }
    }
    napi_value result;
    napi_get_undefined(env, &result);
    return result;
}

NAPI_MODULE_INIT() {
    napi_value check;
    napi_create_function(env, "check", NAPI_AUTO_LENGTH, Check, NULL, &check);
    napi_set_named_property(env, exports, "check", check);
    return exports;
}
