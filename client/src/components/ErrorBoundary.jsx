import { Component } from 'react';
import { withTranslation } from 'react-i18next';

class ErrorBoundaryClass extends Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary:', error, errorInfo);
  }

  render() {
    const { t } = this.props;
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#0f0f0f] p-4">
          <div className="text-center text-gray-300 max-w-md">
            <h1 className="text-xl font-semibold text-white mb-2">{t('errorBoundary.title')}</h1>
            <p className="mb-4">{t('errorBoundary.description')}</p>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, error: null })}
              className="px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-500"
            >
              {t('errorBoundary.tryAgain')}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export const ErrorBoundary = withTranslation()(ErrorBoundaryClass);

export default ErrorBoundary;
