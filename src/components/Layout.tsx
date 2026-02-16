import { Outlet } from 'react-router-dom';

export default function Layout() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 bg-gray-900">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <h1 className="text-lg font-bold tracking-tight">BTC Signal Scanner</h1>
          <span className="text-xs text-gray-500">BTCUSDT | 1H | LONG only</span>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>

      <footer className="border-t border-gray-800 bg-gray-900 py-3 text-center text-xs text-gray-500">
        Educational demo. Not financial advice.
      </footer>
    </div>
  );
}
