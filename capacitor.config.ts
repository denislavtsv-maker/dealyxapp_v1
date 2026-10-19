import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'online.dealyx.app',
  appName: 'Dealyx',
  webDir: 'www',
  server: {
    // Preview shell connects to the existing production site and therefore shares its API,
    // user accounts, listings, messages, and database. Before public store submission, bundle
    // a tested local frontend build instead of relying on a remote URL.
    url: 'https://dealyx.online/?dealyx_app=1#/login',
    cleartext: false,
    allowNavigation: ['dealyx.online', '*.dealyx.online']
  },
  ios: { contentInset: 'automatic' },
  android: { allowMixedContent: false },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1800,
      launchAutoHide: true,
      launchFadeOutDuration: 250,
      backgroundColor: '#EEFBFC',
      androidScaleType: 'CENTER_INSIDE',
      showSpinner: false
    }
  }
};
export default config;
