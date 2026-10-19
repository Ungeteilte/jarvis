/** Zugriff auf die von Capacitor injizierte Bridge. */
export const Capacitor = globalThis.Capacitor || {
  isNativePlatform: () => false,
  getPlatform: () => 'web',
  Plugins: {}
};
export const Plugins = Capacitor.Plugins || {};
