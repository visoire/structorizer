# iPadOS & Native Wrapper Guide (Phase 5)

## 1. Architectural Background: Why Web + WKWebView Beats JVM-on-iOS

Apple's iOS and iPadOS security model strictly forbids Just-In-Time (JIT) compilation (`W^X` memory protection) and dynamic JVM bytecode execution. Running the original Java Swing desktop application on iPadOS would require ahead-of-time (AOT) compilation via Gluon/GraalVM SubstrateVM (`OpenJDK Zero` + Project Leyden) or rewriting the Swing UI in Codename One.

By building **Structorizer Web** as a zero-dependency, client-side TypeScript application with its own SVG layout engine, step interpreter, Turtleizer, and `.nsd`/`.arrz` parser, the entire application runs natively at 120 Hz ProMotion inside Safari or a Capacitor `WKWebView` container with **zero network requests**.

---

## 2. Option A: Instant Offline PWA on iPadOS (Zero App Store Required)

1. Serve or host the `release/structorizer-web/` folder over HTTPS (or open `structorizer-single.html` directly in Files / Safari).
2. In Safari on iPadOS, tap **Share → Add to Home Screen**.
3. The bundled Service Worker (`sw.js`) and `manifest.webmanifest` cache all application assets locally so Structorizer launches full-screen (`display: standalone`) and works 100% offline.
4. Structorizer shows this guide itself: in a Safari tab on an iPad or iPhone a short dialog explains the steps once ("Not now": again after 14 days, "Do not show again": never; never in the Home Screen app or the single-file edition). It is always available under **Help > Add to Home Screen (iPad) ...**. Rules: `src/ui/installTipRules.ts` (tests in `tests/review-fixes.test.ts`), dialog: `src/ui/InstallTip.tsx`.
5. The Home Screen app has its own storage, separate from Safari: save diagrams as `.nsd` files before switching and open them there again. The app asks for persistent storage (`navigator.storage.persist()`) so iPadOS does not clear the autosave.

---

## 3. Option B: Native iPadOS App Store / TestFlight Build via Capacitor

`main/web/capacitor.config.json` is pre-configured for packaging Structorizer into a native iPadOS `.ipa`.

### Build Steps (on macOS with Xcode 16+)
```bash
cd main/web
npm install
npm run build

# Install Capacitor iOS platform (first time only)
npm install -D @capacitor/cli @capacitor/core @capacitor/ios
npx cap add ios

# Sync built web assets into the Xcode project and open Xcode
npx cap sync ios
npx cap open ios
```

### Registering `.nsd` and `.arrz` File Associations in `Info.plist`
Add the following `UTExportedTypeDeclarations` and `CFBundleDocumentTypes` to `ios/App/App/Info.plist` so tapping `.nsd` or `.arrz` files in the iPadOS **Files** app opens Structorizer directly:

```xml
<key>CFBundleDocumentTypes</key>
<array>
  <dict>
    <key>CFBundleTypeName</key>
    <string>Structorizer Diagram</string>
    <key>LSHandlerRank</key>
    <string>Owner</string>
    <key>LSItemContentTypes</key>
    <array>
      <string>lu.fisch.structorizer.nsd</string>
      <string>lu.fisch.structorizer.arrz</string>
    </array>
  </dict>
</array>
<key>UTExportedTypeDeclarations</key>
<array>
  <dict>
    <key>UTTypeIdentifier</key>
    <string>lu.fisch.structorizer.nsd</string>
    <key>UTTypeDescription</key>
    <string>Structorizer Nassi-Shneiderman Diagram</string>
    <key>UTTypeConformsTo</key>
    <array>
      <string>public.xml</string>
      <string>public.data</string>
    </array>
    <key>UTTypeTagSpecification</key>
    <dict>
      <key>public.filename-extension</key>
      <array>
        <string>nsd</string>
      </array>
    </dict>
  </dict>
  <dict>
    <key>UTTypeIdentifier</key>
    <string>lu.fisch.structorizer.arrz</string>
    <key>UTTypeDescription</key>
    <string>Structorizer Zipped Arrangement</string>
    <key>UTTypeConformsTo</key>
    <array>
      <string>public.zip-archive</string>
    </array>
    <key>UTTypeTagSpecification</key>
    <dict>
      <key>public.filename-extension</key>
      <array>
        <string>arrz</string>
      </array>
    </dict>
  </dict>
</array>
```

---

## 4. Apple Pencil, Touch Arbitrator & Magic Keyboard Features (`src/ui/ipad.ts`)

| Hardware Feature | Implementation in Structorizer |
|---|---|
| **Apple Pencil Hover (M2+ iPad Pro / Air)** | Highlights the target diagram element before the stylus tip touches the glass (`pointerType === 'pen'`, `buttons === 0`). |
| **Apple Pencil Pro Squeeze & Double-Tap** | Opens the OwlLuna-inspired radial **InkDish** element palette right at the stylus tip (`⌘K` or double-tap background with Pencil). |
| **Apple Pencil USB-C Fallback** | Synthesizes dynamic velocity-based pressure when hardware reports flat `pressure: 0.5`. |
| **Spherical ⇄ Cartesian Tilt Math** | Bidirectional W3C Pointer Events Level 3 `tiltX`/`tiltY` ⇄ `altitudeAngle`/`azimuthAngle` conversion (`TiltMathConverter`). |
| **Palm Rejection (`TouchArbitrator`)** | Rejects stray palm touches while `pen` is active or within 500 ms of stylus lift (`LoneFingerHold` state machine). |
| **Procreate Multi-Touch Gestures** | **Two-finger tap** triggers Undo; **three-finger tap** triggers Redo. |
| **Magic Keyboard Shortcuts** | `⌥1`..`⌥0`, `⌥-` insert all 11 element kinds (since iPad Magic Keyboard lacks `F5`–`F12`), `⌘9` fits diagram to window, `⌘K` opens the radial InkDish, `Shift+↑/↓` selects a contiguous element range. |
| **Dynamic On-Screen Keyboard Avoidance** | Tracks `window.visualViewport` and updates `--kb-inset` so modals and editors never hide behind the floating/docked iPad keyboard. |
