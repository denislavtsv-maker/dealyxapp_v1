#!/usr/bin/env node
/*
 * Dealyx Android patch applied after `npx cap add android`.
 * - enables normal and third-party WebView cookies for the remote Dealyx site
 * - flushes cookies during lifecycle transitions
 * - applies aqua Android system bars
 * - makes Android Back navigate WebView history when possible
 *
 * Capacitor may generate a minimal MainActivity with no onCreate override.
 * This script supports both that shape and a generated activity with onCreate.
 */
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
    const fullPath = join(dir, name);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isDirectory()) walk(fullPath, out);
    else if (name === 'MainActivity.java') out.push(fullPath);
  }
  return out;
}

const files = walk(JAVA_DIR);
if (!files.length) {
  console.error('[patch-android] No MainActivity.java found under ' + JAVA_DIR);
  console.error('[patch-android] Run `npx cap add android` first.');
  process.exit(2);
}

const CLASS_RE = /public\s+class\s+MainActivity\s+extends\s+BridgeActivity\s*\{/;

function missingBlocks(src) {
  const blocks = [];

  if (!/setAcceptCookie\s*\(\s*true\s*\)/.test(src) ||
      !/setAcceptThirdPartyCookies\s*\(/.test(src)) {
    blocks.push(`
        // --- Dealyx: WebView cookie/session persistence ---
        try {
            android.webkit.CookieManager cookieManager = android.webkit.CookieManager.getInstance();
            cookieManager.setAcceptCookie(true);
            android.webkit.WebView dealyxWebView = (getBridge() != null)
                ? getBridge().getWebView() : null;
            if (dealyxWebView != null) {
                cookieManager.setAcceptThirdPartyCookies(dealyxWebView, true);
            }
            cookieManager.flush();
        } catch (Exception e) {
            android.util.Log.e("Dealyx", "Could not configure WebView cookies", e);
        }
        // --- end Dealyx cookie/session patch ---`);
  }

  if (!/Dealyx: Aqua system bars/.test(src)) {
    blocks.push(`
        // --- Dealyx: Aqua system bars ---
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
            getWindow().setNavigationBarColor(android.graphics.Color.rgb(0, 210, 220));
            getWindow().setStatusBarColor(android.graphics.Color.rgb(238, 251, 252));
        }
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            getWindow().getDecorView().setSystemUiVisibility(
                getWindow().getDecorView().getSystemUiVisibility()
                    | android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
                    | android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        }
        // --- end Dealyx aqua system bars ---`);
  }

  if (!/Dealyx: Android back navigates WebView history/.test(src)) {
    blocks.push(`
        // --- Dealyx: Android back navigates WebView history ---
        getOnBackPressedDispatcher().addCallback(this,
            new androidx.activity.OnBackPressedCallback(true) {
                @Override
                public void handleOnBackPressed() {
                    android.webkit.WebView webView = (getBridge() != null)
                        ? getBridge().getWebView() : null;
                    if (webView != null && webView.canGoBack()) {
                        webView.goBack();
                        return;
                    }
                    // No page history left: hand Back to Android/Capacitor.
                    remove();
                    getOnBackPressedDispatcher().onBackPressed();
                }
            });
        // --- end Dealyx Android back patch ---`);
  }

  return blocks;
}

function patchFile(file) {
  let src = readFileSync(file, 'utf8');
  const before = src;

  if (!CLASS_RE.test(src)) {
    return { file, error: 'Unexpected MainActivity structure; expected BridgeActivity.' };
  }

  const needs = missingBlocks(src);
  if (CHECK_ONLY) {
    const ok = needs.length === 0 && /void\s+onCreate\s*\(/.test(src);
    return { file, ok, error: ok ? null : 'one or more required Dealyx patches are missing' };
  }

  if (!/void\s+onCreate\s*\(/.test(src)) {
    const classMatch = src.match(CLASS_RE);
    const insertionPoint = classMatch.index + classMatch[0].length;
    const method = `

    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
${needs.join('\n')}
    }
`;
    src = src.slice(0, insertionPoint) + method + src.slice(insertionPoint);
  } else {
    const superCall = /super\.onCreate\s*\(\s*[A-Za-z_$][\w$]*\s*\)\s*;/;
    const callMatch = src.match(superCall);
    if (!callMatch) {
      return { file, error: 'Found onCreate(), but could not find its super.onCreate(...) call.' };
    }
    if (needs.length) {
      const insertionPoint = callMatch.index + callMatch[0].length;
      src = src.slice(0, insertionPoint) + '\n' + needs.join('\n') + src.slice(insertionPoint);
    }
  }

  // Persist WebView cookies when Android pauses/stops the app.
  const lifecycleMethods = [];
  for (const method of ['onPause', 'onStop']) {
    const escaped = method;
    if (!new RegExp(`void\\s+${escaped}\\s*\\(`).test(src)) {
      lifecycleMethods.push(`
    @Override
    public void ${method}() {
        try {
            android.webkit.CookieManager.getInstance().flush();
        } catch (Exception e) {
            android.util.Log.w("Dealyx", "Cookie flush failed during ${method}", e);
        }
        super.${method}();
    }
`);
    } else {
      const existingFlush = new RegExp(
        `void\\s+${escaped}\\s*\\([^)]*\\)\\s*\\{[^}]*CookieManager[\\s\\S]*?flush\\s*\\(`,
        's'
      );
      if (!existingFlush.test(src)) {
        const methodStart = new RegExp(`(void\\s+${escaped}\\s*\\([^)]*\\)\\s*\\{`);
        src = src.replace(methodStart, `$1\n        try { android.webkit.CookieManager.getInstance().flush(); } catch (Exception ignored) {}`);
      }
    }
  }

  if (lifecycleMethods.length) {
    const close = src.lastIndexOf('}');
    if (close < 0) return { file, error: 'Could not locate class closing brace.' };
    src = src.slice(0, close) + lifecycleMethods.join('\n') + src.slice(close);
  }

  if (src !== before) writeFileSync(file, src, 'utf8');

  const finalNeeds = missingBlocks(src);
  if (finalNeeds.length || !/void\s+onCreate\s*\(/.test(src)) {
    return { file, error: 'Patch verification failed after writing the file.' };
  }
  return { file, changed: src !== before };
}

let failures = 0;
for (const file of files) {
  const result = patchFile(file);
  if (result.error) {
    console.error(`[patch-android] ${CHECK_ONLY ? 'NOT OK' : 'ERROR'}: ${result.file}: ${result.error}`);
    failures++;
  } else if (CHECK_ONLY) {
    console.log(`[patch-android] OK: ${result.file}`);
  } else {
    console.log(`[patch-android] ${result.changed ? 'patched' : 'already up to date'}: ${result.file}`);
  }
}

if (failures) process.exit(1);
console.log(`[patch-android] ${CHECK_ONLY ? 'verification passed' : 'done'} (${files.length} file(s))`);
