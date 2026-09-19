# macOS Sparkle releases

macOS packages can install updates and restart through Sparkle 2.10.0 using a free, project-owned Ed25519 key. Settings → Updates → **Install update…** opens Sparkle's native window. That window handles the download, signature verification, installation, and restart. The existing GitHub check supplies the notification in Settings. Sparkle's background checks and automatic downloads are disabled.

The app stays ad-hoc signed. First-time users still need to copy it to Applications and approve the first launch through macOS Privacy & Security when prompted. Sparkle signatures authenticate subsequent updates; Apple notarization is a separate service. The current Electron packages require macOS 13 or later (Sparkle itself requires macOS 12).

## One-time setup on your Mac

Run from `desktop-app/` after installing dependencies with `npm ci`:

```sh
npm run sparkle:tools
build/sparkle-2.10.0/bin/generate_keys --account ani-desktop
```

Allow the tool's Keychain request. It creates the private key in your login Keychain and prints the matching public key. Running it again with the same account reuses that key. Keep an encrypted backup of the exported private key in a password manager or another secure location you control. Without Developer ID signing, losing this key can require users to install a replacement release manually.

Open the repository's [Actions secrets and variables](https://github.com/HanifiNF/Ani-desktop/settings/secrets/actions).

| Tab | Name | Value |
| --- | --- | --- |
| Secrets → New repository secret | `SPARKLE_PRIVATE_KEY` | Entire base64 string exported by `generate_keys -x` |
| Variables → New repository variable | `SPARKLE_PUBLIC_KEY` | Public base64 string printed by `generate_keys -p` |

For the public value:

```sh
build/sparkle-2.10.0/bin/generate_keys --account ani-desktop -p
```

For the private value, export to a restricted temporary directory outside the repository:

```sh
umask 077
sparkle_key_dir=$(mktemp -d)
build/sparkle-2.10.0/bin/generate_keys --account ani-desktop -x "$sparkle_key_dir/private.key"
```

The safest upload path uses an authenticated GitHub CLI with repository secret-management access. It reads the private value directly from the file:

```sh
gh secret set SPARKLE_PRIVATE_KEY --repo HanifiNF/Ani-desktop < "$sparkle_key_dir/private.key"
gh variable set SPARKLE_PUBLIC_KEY --repo HanifiNF/Ani-desktop \
  --body "$(build/sparkle-2.10.0/bin/generate_keys --account ani-desktop -p)"
```

Alternatively, run `pbcopy < "$sparkle_key_dir/private.key"`, paste into the new repository secret's value field, and save it. Use the public output for the variable. Keep private key material out of chat, commits, workflow YAML, logs, and issue attachments.

Once uploaded and backed up, remove the temporary export:

```sh
rm "$sparkle_key_dir/private.key"
rmdir "$sparkle_key_dir"
unset sparkle_key_dir
pbcopy < /dev/null
```

Your Keychain copy remains. GitHub stores the secret encrypted and supplies it to the signing step at runtime; its UI allows replacement but does not reveal the saved value. No Apple membership, `.p12` certificate, or notarization password is used by this workflow.

## Release procedure

1. Set both values above, then run **Actions → Desktop release → Run workflow → Test packages** on this branch. This builds Intel and Apple Silicon packages with the public key; it does not access the private key or publish feeds.
2. Merge the implementation into `master`. Run **Publish release** on `master`, or let the scheduled release run.
3. The macOS build embeds the public key and an architecture-specific HTTPS feed URL. It creates ad-hoc-signed DMGs for initial installation and ZIPs for Sparkle updates.
4. After checks and builds succeed, the separate `sparkle-sign` macOS job receives the private secret. It verifies the key pair and each ZIP's embedded configuration, uses upstream `generate_appcast` to sign the archives and feeds, then verifies the feed signatures. The private value is passed through standard input; it is never written to an artifact or command argument.
5. The publication job uploads both `appcast-x64.xml` and `appcast-arm64.xml` with the matching ZIPs before publishing the draft release. Installed apps use GitHub's `/releases/latest/download/appcast-ARCH.xml` redirect.

Users install the first Sparkle-enabled release manually once. Later releases can update through its native window. Publish a newer version to exercise the complete public GitHub path. Keep the signing key and public variable stable across releases. Removing the public variable creates DMG-fallback builds, so keep it configured after enabling Sparkle for users.

When the public variable is absent, packaging retains manual DMG updates. When it is present, a missing or mismatched private secret blocks release publication. Test packages and pull-request checks never receive the production secret. Protect `master` and review release workflow changes: trusted code running in the signing job can access its secret.

## Contributor workflow

Windows/Linux contributors continue using `npm ci`, `npm run dev`, `npm test`, and `npm run build`. There are no native install scripts or macOS SDK requirements for these commands. Only macOS packaging invokes `xcrun clang` and downloads the checksum-pinned official Sparkle framework. The small Node-API bridge uses Sparkle's standard updater controller and is compiled separately for each CPU.

For a local Sparkle-enabled macOS build, set `SPARKLE_PUBLIC_KEY` to the project's public value before `npm run dist:mac`. The private key is needed only to sign update archives and feeds. Local builds without the variable use the manual fallback. Integration testing should use a separate ephemeral key and isolated app/profile, never the production private key.

The macOS CI job builds both architectures with a disposable public key and runs `npm run test:sparkle -- --smoke`. This loads the real packaged bridge and checks a signed loopback feed in an isolated fixture. For an interactive install/relaunch test, run `npm run test:sparkle` and use the test app's native buttons. Run `npm run test:sparkle -- --invalid-signature` to verify rejection, dismiss the error, and quit the test app. These commands create their own ephemeral keys and temporary profiles, then remove their fixtures.

The packaging verifier mounts both DMGs and checks bundle signatures, CPU architectures, the embedded public key, and required Sparkle options. Full ZIP updates are used initially; delta updates are disabled. The framework license and Node-API header license ship inside the macOS bundle.

References: [Sparkle setup and signing](https://sparkle-project.org/documentation/), [programmatic setup](https://sparkle-project.org/documentation/programmatic-setup/), [GitHub Actions secrets](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions).
