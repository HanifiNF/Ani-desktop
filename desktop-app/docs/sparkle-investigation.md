# Sparkle integration investigation

Implementation now uses the official 2.10.0 framework through a small Node-API bridge and Sparkle’s standard native update window. See [release setup](sparkle-release-setup.md). The findings below record the initial investigation.

Investigated 19 September 2026. Apple Developer Program membership is outside this project's budget.

## Finding and local proof

Sparkle is a viable route to macOS installation and relaunch using the existing ad-hoc signing. Update authenticity can come from a project-owned Ed25519 key. This is independent of the Apple-issued identity used by the current Electron/Squirrel update mechanism. Upstream's [update validator](https://github.com/sparkle-project/Sparkle/blob/2.x/Sparkle/SUUpdateValidator.m) accepts a valid archive signature under the installed app's public key and explicitly permits ad-hoc bundle signing.

A local proof used the official Sparkle 2.10.0 framework on Apple Silicon, two isolated ad-hoc-signed fixture apps, a loopback HTTP feed, and an ephemeral Ed25519 key. The key was written only to a temporary file and removed afterward. The fixture bundle identifier was random; the real ANIdesktop installation and its data were untouched.

| Case | Result |
| --- | --- |
| Valid signed update | Downloaded and installed version 2 over version 1; updater exited successfully; strict bundle signature verification passed afterward. |
| Invalid archive signature | Updater rejected installation; version 1 remained intact and passed strict bundle signature verification. |

The framework archive was verified against GitHub's SHA-256 asset digest: `c2bf58aa8387266ac179357b1415d6f2635f044da8be41042af32425dae6da0c`. The proof used the public-API harness from `Innei/electron-sparkle-updater` commit `e7a82fe864faae89cd58ef9abd1e52f8fa1ad82d`, linked to official upstream Sparkle instead of that project's patched framework.

This proves download, signature validation, and bundle replacement for an ad-hoc-signed fixture. Electron addon loading, terminating/relaunching ANIdesktop, Intel execution, first-launch Gatekeeper approval, and protected installation directories still need packaged integration tests.

## Integration choices

The [electron-sparkle-updater bridge](https://github.com/Innei/electron-sparkle-updater) version 0.5.1 exposes lifecycle events and an explicit install-now operation through an Objective-C++ N-API addon. Its custom user driver automatically starts a download when its check finds an update. ANIdesktop should therefore invoke that check on **Download update**, retaining the existing lightweight GitHub check for startup notifications. Periodic Sparkle checks should stay disabled to preserve the current user-initiated download behavior.

The bridge's packaging toolchain pins a modified Sparkle 2.9.4 for multi-step delta updates. Upstream has since shipped installer and delta hardening in 2.9.5/2.9.6 and released [2.10.0](https://github.com/sparkle-project/Sparkle/releases/tag/2.10.0). Recommendation: use a small bridge against pinned, current upstream Sparkle with full ZIP updates initially, or first update and audit the existing bridge's framework fork. Treat adopting its bundled fork as a separate maintenance decision.

An external `sparkle-cli` process is another possible route, but its immediate/deferred install semantics offer less direct control over ANIdesktop's two-step download/restart UI. An in-process bridge fits the existing Settings controls better.

## Proposed project changes

1. Bundle current `Sparkle.framework` and an arm64/x64 native bridge in the macOS app. Preserve framework symlinks, unpack the native addon from ASAR, and sign the completed bundle with the existing ad-hoc workflow. Retain the hardened-runtime entitlements needed by Electron. Current Sparkle requires macOS 12 or later.
2. Generate a persistent Ed25519 keypair for releases. Embed the public key in `SUPublicEDKey` before signing the app. Store the private key as a GitHub Actions secret and keep a protected backup. Losing this sole update-signing key would require users to install a new trusted bootstrap release manually.
3. Publish a ZIP and signed appcast for each architecture alongside the existing DMGs. Suggested feed assets are `appcast-mac-arm64.xml` and `appcast-mac-x64.xml`, reached through GitHub's latest-release download URLs. Each feed must reference its corresponding immutable tagged ZIP asset. Sign the final archives and feed after all packaging changes.
4. Connect bridge events to `UpdateInstaller`'s progress, ready, and error states. Retain the existing download-only fallback if native initialization fails. Keep restart explicit and wait for state writes before requesting installation.
5. Extend release verification to check native architectures, framework loading, embedded public keys, signatures, and feed/asset agreement. Run version N → N+1 packaged Electron tests on both Mac architectures, including wrong-key rejection, download failure, read-only locations, and relaunch.

The first Sparkle-enabled release must be installed manually so the framework and public trust key reach existing users. Later updates can use the in-app flow. The proposed setup requires a free project-owned signing key and a CI secret, with no Apple subscription.

## Gatekeeper remains a separate first-install concern

This does not notarize ANIdesktop. Users downloading the initial app may still need **System Settings → Privacy & Security → Open Anyway**. The screenshot's “Apple checked it for malicious software” message indicates Apple notarization. Sparkle authenticates subsequent updates using the key already embedded in the installed app. Folder permissions and macOS protections can still affect replacement, so this investigation does not promise prompt-free updating on every machine. See [Apple's launch guidance](https://support.apple.com/en-mk/102445) and [Sparkle's signing documentation](https://sparkle-project.org/documentation/).

## Current implementation status

Windows NSIS and Linux AppImage install-and-restart use `electron-updater`. macOS now integrates upstream Sparkle 2.10.0 through a small Objective-C Node-API bridge and the standard Sparkle update window. The release workflow builds per-architecture ZIPs and signs both archives and feeds in a separate job. See the [key setup guide](sparkle-release-setup.md).

Local implementation validation built both Intel and Apple Silicon DMGs and ZIPs, verified their signatures and native architectures, and generated/verified signed feeds using an ephemeral key. On Apple Silicon, a disposable packaged Electron fixture updated from 1.0.0 to 1.1.0 and relaunched successfully. An invalid archive signature produced Sparkle's validation error and retained version 1.0.0. Intel runtime testing and a release-to-release test through public GitHub hosting remain release validation tasks. The CI smoke test uses disposable keys and never accesses production signing material.
