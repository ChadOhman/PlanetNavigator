import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: 'src/renderer',
    // Static files (incl. the generated tiles/ pyramid) live in app/public, not under root.
    publicDir: resolve('public'),
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: resolve('src/renderer/index.html'),
        output: {
          manualChunks: (id) => {
            // OpenLayers and its dependencies go into 'ol' chunk
            if (
              id.includes('/node_modules/ol/') ||
              id.includes('/node_modules/rbush/') ||
              id.includes('/node_modules/quickselect/') ||
              id.includes('/node_modules/pbf/') ||
              id.includes('/node_modules/earcut/') ||
              id.includes('/node_modules/color-') ||
              id.includes('/node_modules/geotiff/')
            ) {
              return 'ol'
            }
            // Everything else from node_modules goes into 'vendor'
            if (id.includes('/node_modules/')) {
              return 'vendor'
            }
          }
        }
      }
    }
  }
})
