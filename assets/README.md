# Dealyx — Neon Green Android assets (Capacitor 7)

Пакетът е подготвен за GitHub repository `denislavtsv-maker/dealyxapp_v1`. Новото лого е светещо зелено, а иконата, adaptive icon слоевете, splash екраните и цветовете на Android system bars са синхронизирани с него.

## Вариант A — само папка assets
Използвай `dealyxapp_v1-assets.zip`, ако искаш само графичните файлове. Разархивирай го и замени директорията `assets/` в root на repo-то. Не поставяй folder-in-folder (`assets/assets`).

## Вариант B — цялостен overlay за компилация (препоръчително)
Този архив съдържа `assets/` плюс съвместимите build настройки по същите пътища като в repository:
- `package.json` — neon-green цветове за `npm run assets:generate`;
- `capacitor.config.ts` — тъмен splash background;
- `scripts/patch-android.mjs` — запазва WebView cookies и Back navigation, задава тъмни/зелени системни ленти;
- `.github/workflows/android.yml` — build артефактите се именуват `dealyx-neon-green-*`.

Разархивирай `dealyxapp_v1-neon-green-compile-pack.zip` локално и качи/замени тези файлове в root на repo `dealyxapp_v1`, запазвайки същата структура. Commit/Push към `main`.

## Компилация
GitHub Actions стартира при push към `main` или ръчно през Actions → Build Dealyx Neon Green Android App → Run workflow. След успешен build отвори run-а и изтегли artifact `dealyx-neon-green-debug-apk`. За подписан release APK/AAB трябва да са конфигурирани GitHub Secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

## Файлове в assets/
- `icon-only.png`, `icon-foreground.png`, `icon-background.png`: Capacitor custom mode — всички 1024×1024. Foreground-ът е оставен със safe margin за adaptive icon.
- `splash.png`, `splash-dark.png`: 2732×2732, задължителният размер за Capacitor splash source.
- `logo.svg`, `logo-wordmark.svg`, `logo.png`, `favicon.svg`, PNG favicon размери.
- `dealyx-library/`: рамки, фонове и илюстрации за използване в UI/магазина.

`capacitor.config.ts` запазва текущия адрес `https://dealyx.online`; APK-то продължава да показва production сайта, не bundle-ва самостоятелно backend-а.
