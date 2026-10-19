
#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const JAVA_DIR = path.join(
  ROOT,
  'android',
  'app',
  'src',
  'main',
  'java'
);

const CHECK_ONLY = process.argv.includes('--check');

function log(message) {
  console.log(`[patch-android] ${message}`);
}

function fail(message) {
  console.error(`[patch-android] ERROR: ${message}`);
  process.exit(1);
}

function findMainActivity(dir) {
  if (!fs.existsSync(dir)) return null;

  for (const entry of fs.readdirSync(dir, {
    withFileTypes: true
  })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const result = findMainActivity(fullPath);
      if (result) return result;
    } else if (entry.name === 'MainActivity.java') {
      return fullPath;
    }
  }

  return null;
}

const file = findMainActivity(JAVA_DIR);

if (!file) {
  fail(`MainActivity.java not found under ${JAVA_DIR}`);
}

let source = fs.readFileSync(file, 'utf8');

if (!source.includes('extends BridgeActivity')) {
  fail('MainActivity does not extend BridgeActivity; refusing unsafe patch.');
}

if (CHECK_ONLY) {
  if (!/void\s+onCreate\s*\(\s*Bundle\s+\w+\s*\)/.test(source)) {
    fail('onCreate(Bundle) is missing.');
  }

  log('Check passed.');
  process.exit(0);
}

function addImport(javaSource, importLine) {
  if (javaSource.includes(importLine)) return javaSource;

  const packageMatch = javaSource.match(/^package\s+[^;]+;\s*/m);

  if (!packageMatch) {
    fail('Could not find Java package declaration.');
  }

  const insertAt = packageMatch.index + packageMatch[0].length;

  return (
    javaSource.slice(0, insertAt) +
    '\n' +
    importLine +
    javaSource.slice(insertAt)
  );
}

source = addImport(source, 'import android.os.Bundle;');
source = addImport(source, 'import android.graphics.Color;');
source = addImport(source, 'import android.view.View;');
source = addImport(source, 'import android.webkit.CookieManager;');
source = addImport(source, 'import android.webkit.WebView;');
source = addImport(source, 'import android.os.Build;');

const classPattern =
  /public\s+class\s+MainActivity\s+extends\s+BridgeActivity\s*\{/;

if (!classPattern.test(source)) {
  fail('Could not locate MainActivity class declaration.');
}

const onCreatePattern =
  /@Override\s+public\s+void\s+onCreate\s*\(\s*Bundle\s+\w+\s*\)\s*\{[\s\S]*?\n\s*\}/;

const patchedOnCreate = `@Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        try {
            CookieManager cookieManager = CookieManager.getInstance();
            cookieManager.setAcceptCookie(true);

            WebView webView = getBridge() != null
                ? getBridge().getWebView()
                : null;

            if (webView != null) {
                cookieManager.setAcceptThirdPartyCookies(webView, true);
                webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
            }
        } catch (Exception e) {
            android.util.Log.e(
                "Dealyx",
                "Could not configure WebView cookies",
                e
            );
        }

        try {
            getWindow().setStatusBarColor(Color.rgb(0, 210, 220));
            getWindow().setNavigationBarColor(Color.rgb(0, 210, 220));

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                getWindow().getDecorView().setSystemUiVisibility(0);
            }
        } catch (Exception e) {
            android.util.Log.e(
                "Dealyx",
                "Could not configure system bars",
                e
            );
        }
    }`;

if (!onCreatePattern.test(source)) {
  source = source.replace(
    classPattern,
    (match) => `${match}\n    ${patchedOnCreate}\n`
  );
} else if (
  !source.includes('Could not configure WebView cookies') ||
  !source.includes('Could not configure system bars')
) {
  source = source.replace(onCreatePattern, patchedOnCreate);
}

if (
  !source.includes('androidx.activity.OnBackPressedCallback') &&
  !source.includes('getOnBackPressedDispatcher')
) {
  source = addImport(
    source,
    'import androidx.activity.OnBackPressedCallback;'
  );

  const backHandler = `
    @Override
    public void onBackPressed() {
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();

            if (webView.canGoBack()) {
                webView.goBack();
                return;
            }
        }

        super.onBackPressed();
    }
`;

  if (!source.includes('void onBackPressed(')) {
    const lastBrace = source.lastIndexOf('}');

    if (lastBrace < 0) {
      fail('Could not find class closing brace.');
    }

    source =
      source.slice(0, lastBrace) +
      backHandler +
      source.slice(lastBrace);
  }
}

if (!source.includes('void onPause()')) {
  const lifecycleMethods = `
    @Override
    public void onPause() {
        try {
            CookieManager.getInstance().flush();
        } catch (Exception e) {
            android.util.Log.w("Dealyx", "Cookie flush failed", e);
        }
        super.onPause();
    }
`;

  const lastBrace = source.lastIndexOf('}');

  source =
    source.slice(0, lastBrace) +
    lifecycleMethods +
    source.slice(lastBrace);
}

fs.writeFileSync(file, source, 'utf8');

const result = fs.readFileSync(file, 'utf8');

if (!/void\s+onCreate\s*\(\s*Bundle\s+\w+\s*\)/.test(result)) {
  fail('Verification failed: onCreate(Bundle) is missing.');
}

if (!result.includes('CookieManager.getInstance()')) {
  fail('Verification failed: cookie configuration is missing.');
}

log('MainActivity patched successfully.');
log(`Updated: ${file}`);
