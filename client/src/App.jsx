import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import MainLayout from './components/Layout/MainLayout';
import ProtectedRoute from './components/Auth/ProtectedRoute';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import Login from './pages/Login';
import Register from './pages/Register';
import Overview from './pages/Overview/Overview';
import ActiveRooms from './pages/ActiveRooms/ActiveRooms';
import Archives from './pages/Archive/Archives';
import ArchiveDetail from './pages/Archive/ArchiveDetail';
import Harvest from './pages/Harvest/Harvest';
import Clones from './pages/Clones/Clones';
import Vegetation from './pages/Vegetation/Vegetation';
import Workers from './pages/Workers/Workers';
import Statistics from './pages/Statistics/Statistics';
import AuditLog from './pages/AuditLog/AuditLog';
import Trash from './pages/Trash/Trash';
import Trim from './pages/Trim/Trim';
import Strains from './pages/Strains/Strains';
import Labels from './pages/Labels/Labels';

function App() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0f0f0f]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
    <Routes>
      {/* Public routes */}
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/" replace /> : <Login />}
      />
      <Route
        path="/register"
        element={isAuthenticated ? <Navigate to="/" replace /> : <Register />}
      />

      {/* Protected routes */}
      <Route
        element={
          <ProtectedRoute>
            <MainLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<ProtectedRoute permission="overview:view"><Overview /></ProtectedRoute>} />
        <Route path="/active" element={<ProtectedRoute permission="active:view"><ActiveRooms /></ProtectedRoute>} />
        <Route path="/harvest" element={<ProtectedRoute permission="harvest:view"><Harvest /></ProtectedRoute>} />
        <Route path="/trim" element={<ProtectedRoute permission="trim:view"><Trim /></ProtectedRoute>} />
        <Route path="/clones" element={<ProtectedRoute permission="clones:view"><Clones /></ProtectedRoute>} />
        <Route path="/vegetation" element={<ProtectedRoute permission="vegetation:view"><Vegetation /></ProtectedRoute>} />
        <Route path="/archive" element={<ProtectedRoute permission="archive:view"><Archives /></ProtectedRoute>} />
        <Route path="/archive/:id" element={<ProtectedRoute permission="archive:view"><ArchiveDetail /></ProtectedRoute>} />
        <Route path="/stats" element={<ProtectedRoute permission="stats:view"><Statistics /></ProtectedRoute>} />
        <Route
          path="/workers"
          element={
            <ProtectedRoute permission="users:read">
              <Workers />
            </ProtectedRoute>
          }
        />
        <Route
          path="/audit"
          element={
            <ProtectedRoute permission="audit:read">
              <AuditLog />
            </ProtectedRoute>
          }
        />
        <Route
          path="/trash"
          element={
            <ProtectedRoute permission="audit:read">
              <Trash />
            </ProtectedRoute>
          }
        />
        <Route path="/labels" element={<ProtectedRoute permission="active:view"><Labels /></ProtectedRoute>} />
        <Route path="/strains" element={<Strains />} />
        <Route path="/admin/users" element={<Navigate to="/workers" replace />} />
      </Route>

      {/* Catch all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </ErrorBoundary>
  );
}

export default App;
