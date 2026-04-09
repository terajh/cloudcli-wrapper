import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import 'katex/dist/katex.min.css'

// Initialize i18n
import './i18n/config.js'

// 사용자 디자인 토큰(저장된 색/폰트)을 첫 페인트 전에 즉시 적용해
// 새로고침 시 깜빡임을 방지한다.
import { bootstrapDesignTokens } from './hooks/useDesignTokens'
bootstrapDesignTokens()

// Register service worker for PWA + Web Push support
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(err => {
    console.warn('Service worker registration failed:', err);
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
