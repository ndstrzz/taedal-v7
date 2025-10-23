import { Component, ReactNode } from "react";

type Props = { children: ReactNode };
type State = { hasError: boolean; error?: any };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: undefined };

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, info: any) {
    // Keep this console for quick diagnostics in prod builds with sourcemaps.
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] Uncaught error", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6">
          <h1 className="text-xl font-semibold mb-2">Something went wrong</h1>
          <pre className="text-xs whitespace-pre-wrap">
            {String(this.state.error ?? "Unknown error")}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
