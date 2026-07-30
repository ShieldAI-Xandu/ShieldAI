import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Without this, one uncaught render error anywhere in App.jsx unmounts the
// whole tree and white-screens the session with no recovery path. A reload
// is the reliable fix rather than retrying the render in place — the data
// that matters lives on the server, not in this tab (see App.jsx's
// resume-state handling, which restores the same screen on reload).
class ErrorBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    console.error('ShieldAI: uncaught render error', error, info)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 16,
        background: '#080D18', color: '#E2EDFF',
        fontFamily: 'Inter,system-ui,sans-serif', padding: 24, textAlign: 'center',
      }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Something went wrong.</div>
        <div style={{ fontSize: 14, color: '#7B92B2', maxWidth: 420 }}>
          This screen hit an unexpected error. Reloading usually fixes it — your
          data is saved on the server, not in this tab.
        </div>
        <button onClick={() => window.location.reload()} style={{
          padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
          background: 'linear-gradient(135deg,#00C8FF,#0090BB)',
          color: '#080D18', fontSize: 14, fontWeight: 700,
        }}>
          Reload
        </button>
      </div>
    )
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
