import 'electron'

// `app.quit()` from the tray sets this before closing windows so `window.ts` lets the
// close go through instead of hiding to the tray again. Electron's own types declare `App`
// inside the ambient `Electron` namespace (electron.d.ts: `declare namespace Electron { interface
// App {...} }`), not inside `declare module 'electron'`, so that's what has to be augmented here.
declare global {
  namespace Electron {
    interface App {
      isQuitting?: boolean
    }
  }
}
