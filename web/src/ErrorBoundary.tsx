import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * A throw during render unmounts the whole tree and leaves a blank page, which in a
 * testbed looks exactly like "the server broke". Show the error instead.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI crashed:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ padding: 24 }}>
        <h2 style={{ color: '#ff6b6b' }}>Інтерфейс упав</h2>
        <pre style={{ whiteSpace: 'pre-wrap', color: '#e6ebf5' }}>{this.state.error.message}</pre>
        <button onClick={() => this.setState({ error: null })}>Спробувати ще</button>
      </div>
    );
  }
}
