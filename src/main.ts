import './assets/main.css'
import { Buffer } from 'buffer'

// Polyfill Buffer for the browser
globalThis.Buffer = Buffer

import { createApp } from 'vue'
import App from './App.vue'
import router from './router'

const app = createApp(App)

app.use(router)

app.mount('#app')
