# BagSpec for iPhone

A Flutter app for the BagSpec Worker: deals, deal details, My flips, and
push notifications for new BUY deals, auctions to bid on, and the 7 PM digest.
It signs in with the same password as bagspec.com.

Push goes straight from the Worker to Apple (APNs, `src/push.js`), so no
Firebase or relay service is involved. The app sends its device token to
`POST /api/devices`.

## One-time Apple setup (team AG4SK353YX)

1. **App ID:** Certificates, Identifiers & Profiles → Identifiers → +.
   Bundle ID `com.bagspec.app`. Turn on **Push Notifications**.
2. **App record:** App Store Connect → Apps → + → New App: iOS, name
   "BagSpec", bundle ID `com.bagspec.app`, SKU `bagspec`. Its numeric Apple
   ID goes in the GitHub repository variable `APP_STORE_APP_ID`.
3. **Provisioning profile:** Profiles → + → App Store Connect, app
   `com.bagspec.app`, the existing Apple Distribution certificate. Name it
   exactly **BagSpec App Store**, download it, then:
   `base64 -w0 BagSpec_App_Store.mobileprovision` → GitHub secret
   `IOS_PROVISIONING_PROFILE_BASE64`.
4. **Same as BuyMour:** add these GitHub secrets to `bagspec-worker` with
   the values BuyMour uses: `APP_STORE_CONNECT_ISSUER_ID`,
   `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_PRIVATE_KEY`,
   `IOS_DISTRIBUTION_CERTIFICATE_BASE64`,
   `IOS_DISTRIBUTION_CERTIFICATE_PASSWORD`.
5. **Push key:** Keys → + → Apple Push Notifications service (APNs). An
   existing APNs key for the team also works. Save it as Cloudflare secrets
   from your own terminal:
   - `npx wrangler secret put APNS_KEY_ID` (the 10-character key ID)
   - `npx wrangler secret put APNS_TEAM_ID` (`AG4SK353YX`)
   - `npx wrangler secret put APNS_PRIVATE_KEY` (paste the whole `.p8` file)

## Building a TestFlight beta

GitHub → Actions → **TestFlight beta** → Run workflow. It analyzes, tests,
signs with the "BagSpec App Store" profile, and uploads. This repository is
public, so GitHub's Mac minutes are free here. The build shows up in
TestFlight after Apple finishes processing (usually 5–15 minutes).

## Developing

```bash
cd app
flutter pub get
flutter analyze lib test
flutter test
```

Push only works on a real iPhone. Debug builds register as `sandbox`, and
TestFlight builds as `production`.
