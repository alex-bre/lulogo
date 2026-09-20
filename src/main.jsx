import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { BUILD_LABEL } from './buildInfo'
import { installFontFaces } from './model/fonts'
import { useStore } from './state/store'
import './styles/global.css'
import './styles/theme.css'
import './styles/layout.css'

// So a user can read back exactly which build they hit a bug on.
console.info(`Build ${BUILD_LABEL}`)

// Paint immediately; the bundled fonts load asynchronously. Text is laid out
// against fallback metrics until they arrive, so re-render once they do (the
// canvas subscribes to ui.fontsVersion) to re-measure with the real faces.
installFontFaces().then(() => useStore.getState().fontsLoaded())

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
