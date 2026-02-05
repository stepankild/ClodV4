import { Component } from 'react';

export class ErrorBoundary extends Component {
  state = { hasError: false, error: null, errorInfo: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      const err = this.state.error;
      const msg = err?.message || String(err);
      const stack = this.state.errorInfo?.componentStack || '';
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-[#0f0f0f]">
          <div className="bg-dark-800 border border-red-800 rounded-xl p-6 max-w-lg w-full">
            <h2 className="text-lg font-semibold text-red-400 mb-2">Что-то пошло не так</h2>
            <p className="text-dark-300 text-sm mb-3">
              Страница не загрузилась. Обновите страницу (F5) или нажмите «На главную».
            </p>
            <details className="text-left mb-4">
              <summary className="text-dark-400 text-xs cursor-pointer hover:text-white">Подробности ошибки</summary>
              <pre className="mt-2 p-2 bg-dark-900 rounded text-red-300 text-xs overflow-auto max-h-40 whitespace-pre-wrap break-all">
                {msg}
                {stack ? `\n\n${stack}` : ''}
              </pre>
            </details>
            <a
              href="/"
              className="inline-block px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500"
            >
              На главную
            </a>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
