```js
#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const JAVA_DIR = join(ROOT, 'android', 'app', 'src', 'main', 'java');
const CHECK_ONLY = process.argv.includes('--check');

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }

  for (const name of entries) {
    const p = join(dir, name);
    let info;

    try {
      info = statSync(p);
    } catch {
      continue;
    }

    if (info.isDirectory()) {
      walk(p, out);
    } else if (name === 'MainActivity.java') {
      out.push(p);
    }
  }

  return out;
}

const files = walk(JAVA_DIR);

if (!files.length) {
  console.error('[patch-android] No MainActivity.java found.');
  console.error('[patch-android] Generate the Android project first.');
  process.exit(2);
}

let changed = 0;
let missing = 0;

for (const file of files) {
  let src = readFileSync(file, 'utf8');
  const before = src;

  const hasThirdParty =
    /setAcceptThirdPartyCookies\s*\(/.test(src);
  const hasAccept =
    /setAcceptCookie\s*\(\s*true\s*\)/.test(src);
  const hasBackHandler =
    /Dealyx: Android back navigates WebView history/.test(src);
  const hasAquaBars =
    /Dealyx: Aqua system bars/.test(src);
  const hasPauseFlush =
    /void\s+onPause\s*\([^)]*\)\s*\{[^}]*CookieManager\.getInstance\(\)\.flush\(\)/s.test(src);
  const hasStopFlush =
    /void\s+onStop\s*\([^)]*\)\s*\{[^}]*CookieManager\.getInstance\(\)\.flush\(\)/s.test(src);

  if (!CHECK_ONLY) {
    if (!hasThirdParty || !hasAccept ||
        !hasBackHandler || !hasAquaBars) {
      const marker =
        /(super\.onCreate\s*\(\s*savedInstanceState\s*\)\s*;)/;

      const injection = `$1

        // --- Dealyx: cross-site session persistence ---
        android.webkit.CookieManager cookieManager =
            android.webkit.CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(
            getBridge().getWebView(), true);
        cookieManager.flush();

        // --- Dealyx: Aqua system bars ---
        if (android.os.Build.VERSION.SDK_INT >=
                android.os.Build.VERSION_CODES.LOLLIPOP) {
            getWindow().setNavigationBarColor(
                android.graphics.Color.rgb(0, 184, 199));
            getWindow().setStatusBarColor(
                android.graphics.Color.rgb(238, 251, 252));
        }

        if (android.os.Build.VERSION.SDK_INT >=
                android.os.Build.VERSION_CODES.O) {
            getWindow().getDecorView().setSystemUiVisibility(
                getWindow().getDecorView().getSystemUiVisibility()
                | android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
                | android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        }

        // --- Dealyx: Android back navigates WebView history ---
        getOnBackPressedDispatcher().addCallback(
            this,
            new androidx.activity.OnBackPressedCallback(true) {
                @Override
                public void handleOnBackPressed() {
                    android.webkit.WebView webView =
                        getBridge().getWebView();

                    if (webView != null && webView.canGoBack()) {
                        webView.goBack();
                    } else {
                        setEnabled(false);
                        getOnBackPressedDispatcher().onBackPressed();
                    }
                }
            });
        // --- end Dealyx native patch ---`;

      if (marker.test(src)) {
        src = src.replace(marker, injection);
      } else {
        console.error(
          '[patch-android] Could not find super.onCreate(...) in ' + file
        );
        process.exitCode = 1;
        continue;
      }
    }

    for (const method of ['onPause', 'onStop']) {
      const methodPattern = new RegExp(
        `void\\s+${method}\\s*\\([^)]*\\)\\s*\\{`
      );

      const flushPattern = new RegExp(
        `void\\s+${method}\\s*\\([^)]*\\)\\s*\\{[^}]*CookieManager\\.getInstance\\(\\)\\.flush\\(\\)`,
        's'
      );

      if (!flushPattern.test(src)) {
        if (methodPattern.test(src)) {
          src = src.replace(
            methodPattern,
            match => match +
              '\n        try { android.webkit.CookieManager.getInstance().flush(); } catch (Exception ignored) {}'
          );
        } else {
          const idx = src.lastIndexOf('}');
          if (idx < 0) {
            console.error('[patch-android] Invalid Java class: ' + file);
            process.exitCode = 1;
            continue;
          }

          src = src.slice(0, idx) +
            `
    @Override
    public void ${method}() {
        try {
            android.webkit.CookieManager.getInstance().flush();
        } catch (Exception ignored) {}
        super.${method}();
    }
` + src.slice(idx);
        }
      }
    }

    if (src !== before) {
      writeFileSync(file, src, 'utf8');
      console.log('[patch-android] patched: ' + file);
      changed++;
    }
  }

  const result = readFileSync(file, 'utf8');
  const ok =
    /setAcceptThirdPartyCookies\s*\(/.test(result) &&
    /setAcceptCookie\s*\(\s*true\s*\)/.test(result) &&
    /Dealyx: Android back navigates WebView history/.test(result) &&
    /Dealyx: Aqua system bars/.test(result) &&
    /void\s+onPause\s*\([^)]*\)\s*\{[^}]*CookieManager\.getInstance\(\)\.flush\(\)/s.test(result) &&
    /void\s+onStop\s*\([^)]*\)\s*\{[^}]*CookieManager\.getInstance\(\)\.flush\(\)/s.test(result);

  if (!ok) {
    console.error('[patch-android] NOT PATCHED: ' + file);
    missing++;
  } else {
    console.log('[patch-android] ok: ' + file);
  }
}

if (missing > 0 || process.exitCode) {
  console.error('[patch-android] WebView patch verification failed.');
  process.exitCode = 1;
} else {
  console.log(
    `[patch-android] done (${changed} file(s) changed)`
  );
}
```
