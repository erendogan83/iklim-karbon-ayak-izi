import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import Participant from './Participant.jsx';
import './styles.css';

// Yönetici paneli ayrı pakete bölünür: katılımcı formu admin kodunu ve supabase-js'i yüklemez.
const Admin = lazy(() => import('./admin.jsx'));
const isAdminRoute = /^\/admin(\/|$)/.test(window.location.pathname);

createRoot(document.getElementById('root')).render(
  isAdminRoute
    ? <Suspense fallback={<main className="admin-shell"><p className="muted">Yükleniyor…</p></main>}><Admin /></Suspense>
    : <Participant />,
);
