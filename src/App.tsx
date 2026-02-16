import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Intraday from './pages/Intraday';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Intraday />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
