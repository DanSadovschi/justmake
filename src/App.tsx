import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Chart from './pages/Chart';
import Signals from './pages/Signals';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/chart" element={<Chart />} />
          <Route path="/signals" element={<Signals />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
