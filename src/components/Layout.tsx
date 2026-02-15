import { NavLink, Outlet } from 'react-router-dom';

export default function Layout() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 bg-gray-900">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <h1 className="text-lg font-bold tracking-tight">BTC Daily Signal Demo</h1>
          <nav className="flex gap-4 text-sm">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                isActive ? 'text-amber-400 font-medium' : 'text-gray-400 hover:text-gray-200'
              }
            >
              Dashboard
            </NavLink>
            <NavLink
              to="/chart"
              className={({ isActive }) =>
                isActive ? 'text-amber-400 font-medium' : 'text-gray-400 hover:text-gray-200'
              }
            >
              Chart
            </NavLink>
            <NavLink
              to="/signals"
              className={({ isActive }) =>
                isActive ? 'text-amber-400 font-medium' : 'text-gray-400 hover:text-gray-200'
              }
            >
              Signals
            </NavLink>
            <NavLink
              to="/intraday"
              className={({ isActive }) =>
                isActive ? 'text-amber-400 font-medium' : 'text-gray-400 hover:text-gray-200'
              }
            >
              Intraday
            </NavLink>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>

      <footer className="border-t border-gray-800 bg-gray-900 py-3 text-center text-xs text-gray-500">
        Educational demo. Not financial advice. No real trading.
      </footer>
    </div>
  );
}
