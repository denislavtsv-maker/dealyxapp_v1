#!/usr/bin/env node

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const JAVA_DIR = join(ROOT, 'android', 'app', 'src', 'main', 'java');
const CHECK_ONLY = process.argv.includes('--check');

function walk(dir, out = []) {
  let entries = [];

  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }

  for (const name of entries) {
    const path = join(dir, name);

    try {
      const info = statSync(path);

      if (info.isDirectory()) {
        walk(path, out);
      } else if (name === 'MainActivity.java') {
        out.push(path);
      }
    } catch {
      // Ignore inaccessible files.
    }
  }

  return out;
}

function insertAfterOnCreate(src, block, file) {
  const marker =
    /super\.onCreate\s*\(\s*savedInstanceState\s*\)\s*;/;

  if (!marker.test(src)) {
    console.error(
      '[patch-android] Cannot find super.onCreate(...) in ' + file
    );
    return null;
  }

  return src.replace(marker, function (match) {
    return match + '\n\n' + block;
  });
}

const cookieBlock = [
  '// --- Dealyx: cross-site session persistence ---',
  'android.webkit.CookieManager cookieManager =',
  '    android.webkit.CookieManager.getInstance();',
  'cookieManager.setAcceptCookie(true);',
  'cookieManager.setAcceptThirdPartyCookies(getBridge().getWebView(), true);',
  'cookieManager.flush();',
  '// --- end Dealyx cookie patch ---'
].join('\n');

const aquaBlock = [
  '// --- Dealyx: Aqua system bars ---',
  'if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {',
  '    getWindow().setNavigationBarColor(android.graphics.Color.rgb(0, 184, 199));',
  '    getWindow().setStatusBarColor(android.graphics.Color.rgb(238, 251, 252));',
  '}',
  'if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {',
  '    getWindow().getDecorView().setSystemUiVisibility(',
  '        getWindow().getDecorView().getSystemUiVisibility()',
  '        | android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR',
  '        | android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);',
  '}',
  '// --- end Dealyx system bars ---'
].join('\n');

const backBlock = [
  '// --- Dealyx: Android back navigates WebView history ---',
  'getOnBackPressedDispatcher().addCallback(this,',
  '    new androidx.activity.OnBackPressedCallback(true) {',
  '        @Override',
  '        public void handleOnBackPressed() {',
  '            android.webkit.WebView webView = getBridge().getWebView();',
  '            if (webView != null && webView.canGoBack()) {',
  '                webView.goBack();',
  '            } else {',
  '                setEnabled(false);',
  '                getOnBackPressedDispatcher().onBackPressed();',
  '            }',
  '        }',
  '    });',
  '// --- end Dealyx back handler ---'
].join('\n');

function addLifecycleFlush(src, method, file) {
  const methodRegex = new RegExp(
    'void\\s+' + method + '\\s*\\([^)]*\\)\\s*\\{'
  );

  const flushRegex = new RegExp(
    'void\\s+' + method +
    '\\s*\\([^)]*\\)\\s*\\{[^}]*CookieManager\\.getInstance\\(\\)\\.flush\\(\\)',
    's'
  );

  if (flushRegex.test(src)) {
    return src;
  }

  if (methodRegex.test(src)) {
    return src.replace(methodRegex, function (match) {
      return match +
        '\n        try { android.webkit.CookieManager.getInstance().flush(); } catch (Exception ignored) {}';
    });
  }

  const idx = src.lastIndexOf('}');

  if (idx < 0) {
    console.error('[patch-android] Invalid Java class: ' + file);
    return null;
  }

  const override = [
    '',
    '    @Override',
    '    public void ' + method + '() {',
    '        try {',
    '            android.webkit.CookieManager.getInstance().flush();',
    '        } catch (Exception ignored) {}',
    '        super.' + method + '();',
    '    }',
    ''
  ].join('\n');

  return src.slice(0, idx) + override + src.slice(idx);
}

const files = walk(JAVA_DIR);

if (!files.length) {
  console.error('[patch-android] No MainActivity.java found.');
  console.error('[patch-android] Generate the Android project first.');
  process.exit(2);
}

let changed = 0;
let failed = false;

for (const file of files) {
  const original = readFileSync(file, 'utf8');
  let src = original;

  if (!CHECK_ONLY) {
    if (!src.includes('// --- Dealyx: cross-site session persistence ---')) {
      const next = insertAfterOnCreate(src, cookieBlock, file);
      if (next === null) {
        failed = true;
        continue;
      }
      src = next;
    }

    if (!src.includes('// --- Dealyx: Aqua system bars ---')) {
      const next = insertAfterOnCreate(src, aquaBlock, file);
      if (next === null) {
        failed = true;
        continue;
      }
      src = next;
    }

    if (!src.includes('// --- Dealyx: Android back navigates WebView history ---')) {
      const next = insertAfterOnCreate(src, backBlock, file);
      if (next === null) {
        failed = true;
        continue;
      }
      src = next;
    }

    src = addLifecycleFlush(src, 'onPause', file);
    if (src === null) {
      failed = true;
      continue;
    }

    src = addLifecycleFlush(src, 'onStop', file);
    if (src === null) {
      failed = true;
      continue;
    }

    if (src !== original) {
      writeFileSync(file, src, 'utf8');
      changed++;
      console.log('[patch-android] patched: ' + file);
    } else {
      console.log('[patch-android] already patched: ' + file);
    }
  }

  const result = readFileSync(file, 'utf8');

  const checks = [
    /setAcceptCookie\s*\(\s*true\s*\)/,
    /setAcceptThirdPartyCookies\s*\(/,
    /Dealyx: cross-site session persistence/,
    /Dealyx: Aqua system bars/,
    /Dealyx: Android back navigates WebView history/,
    /void\s+onPause\s*\([^)]*\)\s*\{[^}]*CookieManager\.getInstance\(\)\.flush\(\)/s,
    /void\s+onStop\s*\([^)]*\)\s*\{[^}]*CookieManager\.getInstance\(\)\.flush\(\)/s
  ];

  const ok = checks.every(function (pattern) {
    return pattern.test(result);
  });

  if (!ok) {
    console.error('[patch-android] NOT PATCHED: ' + file);
    failed = true;
  } else {
    console.log('[patch-android] verified: ' + file);
  }
}

if (failed) {
  console.error('[patch-android] Patch verification failed.');
  process.exit(1);
}

console.log('[patch-android] done (' + changed + ' file(s) changed)');
